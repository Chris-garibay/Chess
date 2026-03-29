/**
 * ============================================================================
 * engine.js — Stockfish chess engine + optional Lichess cloud fallback
 * ============================================================================
 *
 * NOT EXPRESS / NOT A SERVER ROUTE
 * - Nothing here defines HTTP routes (no app.post, no res.json). This class runs
 *   entirely in the *browser*: it talks to a Web Worker running Stockfish, or
 *   uses fetch() to Lichess's cloud-eval URL. app.js calls engine.analyze(...)
 *   like any other JavaScript function.
 *
 * TEACHING NOTES (read with a student):
 *
 * 1) What is UCI?
 *    "Universal Chess Interface" is a *text protocol*: you send lines like
 *    `position fen <fen>` and `go depth 16`, and the engine replies with
 *    `info ...` lines (partial results) and finally `bestmove e2e4`.
 *    Moves in UCI are "fromsq+tosq" in lowercase, e.g. e2e4; promotion adds
 *    a 5th letter: e7e8q.
 *
 * 2) Why a Web Worker?
 *    Stockfish does heavy CPU work. Running it on the main browser thread would
 *    freeze the UI. Workers run JavaScript in a background thread; we
 *    communicate with postMessage / onmessage.
 *
 * 3) The Blob + importScripts trick
 *    Browsers often block loading a worker script from another domain (CDN).
 *    We create a tiny *inline* worker whose only job is importScripts(stockfish.js).
 *    That satisfies same-origin rules for the worker while still using the CDN
 *    for the heavy engine file.
 *
 * 4) Scores: cp vs mate
 *    `score cp 32` ≈ +0.32 pawns for the side *to move* (engine convention).
 *    `score mate 3` means checkmate in 3 for the side to move (sign matters).
 *    For UI we often convert to "White's perspective" with toWhiteCP().
 *
 * 5) classifyMove
 *    Compare eval before and after a move (in a consistent frame) to estimate
 *    how much the player lost — used for colored move annotations in review.
 *
 * Global: `const engine = new ChessEngine()` — app.js calls `engine.analyze(...)`, etc.
 * Note: index.html loads chess.js *before* engine.js, so `Chess` exists when this file runs
 * (needed for uciToSan).
 * ============================================================================
 */
class ChessEngine {
  constructor() {
    this.worker = null;
    this.ready = false;
    /** Called for each `info depth` line while searching */
    this._infoHandler = null;
    /** Called once with the chosen UCI move when search finishes */
    this._bestMoveHandler = null;
    this._lastDepthSeen = 0;
    this._initWorker();
  }

  /**
   * Spawns the Stockfish worker. If anything fails, worker stays null and
   * analyze() will use _cloudEval() instead.
   */
  _initWorker() {
    const SF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js';
    try {
      // Worker source is a blob URL containing one line: load Stockfish from CDN
      const blob = new Blob([`importScripts('${SF_URL}')`], { type: 'application/javascript' });
      this.worker = new Worker(URL.createObjectURL(blob));
      this.worker.onmessage = (e) => this._onMsg(e.data);
      this.worker.onerror = () => { this.worker = null; };
      // UCI handshake: engine will answer uciok, then we send isready → readyok
      this._send('uci');
    } catch (_) {
      this.worker = null;
    }
  }

  _send(cmd) {
    if (this.worker) this.worker.postMessage(cmd);
  }

  /**
   * Parse Stockfish stdout-style messages (one string per line).
   */
  _onMsg(msg) {
    if (msg === 'uciok') { this._send('isready'); return; }
    if (msg === 'readyok') { this.ready = true; return; }

    // Intermediate search results: depth, score, principal variation (PV)
    if (msg.startsWith('info depth')) {
      const info = this._parseInfo(msg);
      if (info && this._infoHandler) this._infoHandler(info);
    }

    // Final chosen move
    if (msg.startsWith('bestmove')) {
      const parts = msg.split(' ');
      const move = parts[1];
      if (move && move !== '(none)' && this._bestMoveHandler) {
        this._bestMoveHandler(move);
      }
      this._bestMoveHandler = null;
    }
  }

  /**
   * Extract structured fields from one `info depth 12 score cp 20 pv e2e4 ...` line.
   * Returns null if depth is missing (malformed line).
   */
  _parseInfo(msg) {
    const depthM  = msg.match(/\bdepth (\d+)/);
    const cpM     = msg.match(/\bscore cp (-?\d+)/);
    const mateM   = msg.match(/\bscore mate (-?\d+)/);
    const pvM     = msg.match(/\bpv (.+)$/);
    if (!depthM) return null;

    const depth = parseInt(depthM[1]);
    let score = null;
    if (mateM) score = { type: 'mate', value: parseInt(mateM[1]) };
    else if (cpM) score = { type: 'cp', value: parseInt(cpM[1]) };

    return { depth, score, pv: pvM ? pvM[1].trim() : null };
  }

  /**
   * Start analysis of a single position.
   * @param {string} fen - position string (chess.js .fen() is compatible)
   * @param {number} depth - how deep Stockfish should search (higher = stronger, slower)
   * @param {function|null} onInfo - (info) => void; may fire many times
   * @param {function|null} onDone - (uciMove) => void; fires once when bestmove is known
   */
  analyze(fen, depth, onInfo, onDone) {
    if (this.worker) {
      this._infoHandler  = onInfo;
      this._bestMoveHandler = onDone;
      this._send('stop');       // cancel any previous search
      this._send('ucinewgame'); // tell engine we're starting a new game line (resets hash)
      this._send(`position fen ${fen}`);
      this._send(`go depth ${depth}`);
    } else {
      // No worker: one HTTP request to Lichess's precomputed eval cache
      this._cloudEval(fen, onInfo, onDone);
    }
  }

  /** Ask Stockfish to stop searching (used by evalPosition timeout). */
  stop() { this._send('stop'); }

  /**
   * Fallback when Stockfish can't run: Lichess cloud-eval API returns JSON
   * with centipawns or mate and a PV string of UCI moves.
   */
  async _cloudEval(fen, onInfo, onDone) {
    try {
      const r = await fetch(`https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=1`);
      if (!r.ok) return;
      const d = await r.json();
      if (!d.pvs || !d.pvs.length) return;
      const pv = d.pvs[0];
      const score = pv.mate !== undefined
        ? { type: 'mate', value: pv.mate }
        : { type: 'cp',   value: pv.cp   };
      if (onInfo) onInfo({ depth: d.depth || 20, score, pv: pv.moves });
      if (onDone && pv.moves) onDone(pv.moves.split(' ')[0]);
    } catch (_) {}
  }

  /**
   * Promise wrapper for "wait until depth/time and return final score object".
   * Used by game review when analyzing every position in a loop.
   * @param {string} fen
   * @param {number} targetDepth - desired search depth
   * @param {number} timeout - ms; after this we stop() and resolve with best score so far
   * @returns {Promise<{type:'cp'|'mate', value:number}|null>}
   */
  evalPosition(fen, targetDepth = 16, timeout = 6000) {
    return new Promise((resolve) => {
      let best = null;
      const timer = setTimeout(() => { this.stop(); resolve(best); }, timeout);

      this.analyze(fen, targetDepth,
        (info) => {
          // Keep updating best as long as we have a score at reasonable depth
          if (info.score && info.depth >= Math.min(targetDepth, 14)) {
            best = info.score;
          }
        },
        (_move) => {
          clearTimeout(timer);
          resolve(best);
        }
      );
    });
  }

  // ── Score utilities (normalize for UI and move classification) ─────────

  /**
   * Convert engine score to centipawns from *White's* point of view (+ = White better).
   * Mate is approximated as ±10000 so the eval bar can saturate.
   * @param {{type:'cp'|'mate', value:number}} score
   * @param {'w'|'b'} turn - side to move in the position the score refers to
   */
  toWhiteCP(score, turn) {
    if (!score) return 0;
    const raw = score.type === 'mate'
      ? (score.value > 0 ? 10000 : -10000)
      : score.value;
    return turn === 'w' ? raw : -raw;
  }

  /**
   * Short string for the eval label (still derived via white POV then shown as context).
   * Student exercise: try showing "from Black's view" when board is flipped.
   */
  formatScore(score, turn) {
    if (!score) return '0.0';
    const wcp = this.toWhiteCP(score, turn);
    if (score.type === 'mate') {
      const m = Math.abs(score.value);
      return wcp > 0 ? `M${m}` : `-M${m}`;
    }
    return (wcp / 100).toFixed(1);
  }

  /**
   * Classify how good/bad a move was.
   * scoreBefore / scoreAfter: engine scores (side-to-move perspective, Stockfish style).
   * turnBefore: who was about to move *before* the move was played.
   *
   * Idea: after you move, it's the opponent's turn — so scoreAfter is from their POV.
   * We convert both to white POV and measure how much the mover's standing dropped.
   */
  classifyMove(scoreBefore, scoreAfter, turnBefore) {
    if (!scoreBefore || !scoreAfter) return '';
    const wb = this.toWhiteCP(scoreBefore, turnBefore);
    const wa = this.toWhiteCP(scoreAfter, turnBefore === 'w' ? 'b' : 'w');

    // Loss = how much the eval shifted against the player who just moved
    const loss = turnBefore === 'w' ? (wb - wa) : (wa - wb);

    if (loss <= 0)   return 'best';
    if (loss < 25)   return 'great';
    if (loss < 60)   return 'good';
    if (loss < 120)  return 'inaccuracy';
    if (loss < 250)  return 'mistake';
    return 'blunder';
  }

  /**
   * Turn UCI (e2e4) into SAN (e.g. e4) using a copy of the position — for display only.
   */
  uciToSan(chessInstance, uci) {
    try {
      const tmp = new Chess(chessInstance.fen());
      const m = tmp.move({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci[4] || 'q' });
      return m ? m.san : uci;
    } catch (_) { return uci; }
  }
}

/** One shared engine for the whole page (practice, review, puzzles all reuse it). */
const engine = new ChessEngine();
