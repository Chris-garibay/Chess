/**
 * ============================================================================
 * app.js — Chess Coach UI + game logic (main entry after libraries load)
 * ============================================================================
 *
 * READ THIS FIRST IF YOU KNOW EXPRESS BUT NOT THIS PROJECT
 * ----------------------------------------------------------------------------
 * Express is a *server-side* framework (Node.js). You define routes like
 *   app.get('/users', (req, res) => res.json(...))
 * and the *server* sends responses to browsers.
 *
 * This project has **no Express** in the repo for the chess UI. Instead:
 * - index.html is a static document the browser loads.
 * - This file runs in the *browser* after the page loads. It uses the DOM API:
 *   document.getElementById, addEventListener, element.classList, etc.
 * - "Business logic" (chess rules) lives in the chess.js library; we call
 *   `new Chess()` and methods like .move(), .fen(), .game_over().
 * - When we need remote data, chesscom.js uses fetch() from the *browser* to
 *   chess.com — not to your own Express app (unless you add one later).
 *
 * THE DOM (Document Object Model) IN ONE PARAGRAPH
 * ----------------------------------------------------------------------------
 * The browser parses HTML into a tree of objects. Each tag becomes a *node*.
 * JavaScript can *query* nodes (by id, class, CSS selector) and *change* them:
 * text, CSS classes, inline styles, or innerHTML. That is how clicking "Practice"
 * hides one panel and shows another without reloading the page.
 *
 * COMMON PATTERNS IN THIS FILE
 * ----------------------------------------------------------------------------
 * - document.getElementById('new-game') — returns ONE element; null if missing.
 * - document.querySelectorAll('.tab-btn') — returns a *NodeList* of all matches.
 * - .addEventListener('click', () => { ... }) — run code when user clicks.
 * - element.classList.add('active') / .remove('active') — toggle CSS classes
 *   (tabs and buttons use .active; rules live in style.css).
 * - element.innerHTML = '<div>...</div>' — replace contents with an HTML string
 *   (handy for lists; avoid putting raw user input in HTML to reduce XSS risk).
 * - async () => { await ChessCom.getRecentGames(...) } — the click handler can
 *   `await` network calls without blocking painting of the page.
 *
 * TEACHING MAP (suggested lesson order)
 * ----------------------------------------------------------------------------
 * 1) Separation of concerns
 *    - chess.js  → `Chess` instance holds rules, FEN, history (no pixels).
 *    - chessboard-js → `Chessboard(id, options)` draws pieces; callbacks ask
 *      chess.js if a drag/drop is legal.
 *    - engine.js → analysis (Stockfish / cloud).
 *    - chesscom.js → HTTP API (fetch).
 *    - openings-db.js → static opening tree lookup.
 *
 * 2) This file glues DOM events to those pieces: each tab has init*() lazily
 *    called on first visit (tabInited) so we don't create three boards at once.
 *
 * 3) Notation
 *    - SAN = "e4", "Nf3" (what humans read in PGN).
 *    - UCI = "e2e4", "g1f3" (what engines use; also our opening DB keys).
 *
 * Requires (globals from index.html script order):
 *   jQuery ($), Chess, Chessboard, engine, ChessCom, lookupOpening, getContinuations
 * ============================================================================
 */

/** Wikipedia-style piece images for chessboard-js `{piece}` is replaced with wP, bK, etc. */
const PIECES = 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png';

// ═══════════════════════════════════════════════════════════════════════════
//  TAB NAVIGATION
//
//  HTML: each <button class="tab-btn" data-tab="practice"> pairs with
//  <div id="tab-practice" class="tab-content">. We keep "active" in sync on the
//  button and the panel so CSS shows one screen (display:flex vs display:none).
// ═══════════════════════════════════════════════════════════════════════════

/** Remembers which tabs already ran their init*() so we only build boards once. */
const tabInited = {};

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    // data-tab="review" → btn.dataset.tab === "review" (dataset is camelCase in JS)
    const id = btn.dataset.tab;
    document.getElementById(`tab-${id}`).classList.add('active');
    if (!tabInited[id]) { tabInited[id] = true; initTab(id); }
  });
});

/** Route string from tab button to the right initializer (practice loads at page bottom). */
function initTab(id) {
  if (id === 'review')   initReview();
  if (id === 'puzzles')  initPuzzles();
  if (id === 'openings') initOpenings();
}

/**
 * Yellow/orange ring on "from" and "to" squares after a move (uses CSS in style.css).
 * chessboard-js gives squares classes like .square-e4 — we add sq-hl-from / sq-hl-to.
 *
 * jQuery: `$` is a function from the jQuery library (loaded before this file).
 * `$('#practice-board')` means "find element with id practice-board", like
 * document.getElementById but with extra helpers. The backticks are *template
 * literals*: `#${boardId}` inserts the variable into the string.
 */
function hlSquares(boardId, from, to) {
  $(`#${boardId} .square-55d63`).removeClass('sq-hl-from sq-hl-to');
  if (from) $(`#${boardId} .square-${from}`).addClass('sq-hl-from');
  if (to)   $(`#${boardId} .square-${to}`).addClass('sq-hl-to');
}

/**
 * Map engine score → vertical bar fill. Top of bar = Black's side in CSS;
 * we compute what fraction should look "white advantage" vs "black advantage".
 * @param {string} whiteId - element id for the growing white segment
 * @param {string} labelId - text label (e.g. +0.3 or M2)
 */
function setEvalBar(whiteId, labelId, score, turn) {
  // document.getElementById returns a DOM element; .style.height changes inline CSS.
  // .textContent sets visible text (safer than innerHTML when you only need plain text).
  let pct; // percentage of bar that is WHITE (top = black, bottom = white)
  if (!score) { pct = 50; }
  else if (score.type === 'mate') {
    const wcp = engine.toWhiteCP(score, turn);
    pct = wcp > 0 ? 95 : 5;
  } else {
    const wcp = engine.toWhiteCP(score, turn);
    pct = 50 + Math.max(-45, Math.min(45, wcp / 22));
  }
  document.getElementById(whiteId).style.height = `${pct}%`;
  document.getElementById(labelId).textContent = engine.formatScore(score, turn);
}

/**
 * Build HTML for a two-column PGN-style move list (1. e4 e5 2. Nf3 ...).
 * @param {string[]} moves - SAN strings in order
 * @param {number} currentIdx - which ply is "current" (1-based index into positions in review)
 * @param {string[]|null} annotations - parallel array of CSS class names per move (review)
 * @param {function|null} onClickFn - if set, clicking a move jumps review to that index
 */
function renderMoves(containerId, moves, currentIdx, annotations, onClickFn) {
  // We build one big HTML string, then assign it once — faster than dozens of
  // createElement calls for teaching-sized lists. Template literals `${}` embed values.
  let html = '';
  for (let i = 0; i < moves.length; i += 2) {
    const mn = Math.floor(i / 2) + 1;
    const wSan  = moves[i];
    const bSan  = moves[i + 1];
    const wAnn  = (annotations && annotations[i])   || '';
    const bAnn  = (annotations && annotations[i+1]) || '';
    const wCur  = currentIdx === i + 1 ? 'cur' : '';
    const bCur  = currentIdx === i + 2 ? 'cur' : '';
    html += `<div class="mp">
      <span class="mn">${mn}.</span>
      <span class="mt ${wAnn} ${wCur}" data-idx="${i+1}">${wSan}${annSymbol(wAnn)}</span>
      ${bSan ? `<span class="mt ${bAnn} ${bCur}" data-idx="${i+2}">${bSan}${annSymbol(bAnn)}</span>` : ''}
    </div>`;
  }
  const container = document.getElementById(containerId);
  container.innerHTML = html;
  // After innerHTML, new nodes exist but have no listeners — we attach them now.
  // data-idx on each .mt holds which ply index to jump to when clicked (review tab).
  if (onClickFn) {
    container.querySelectorAll('.mt').forEach(el => {
      el.addEventListener('click', () => onClickFn(parseInt(el.dataset.idx)));
    });
  }
  const cur = container.querySelector('.cur');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}

/** Optional glyphs next to moves in review (Lichess-style shortcuts). */
function annSymbol(ann) {
  return { blunder:'??', mistake:'?', inaccuracy:'?!', great:'!', best:'' }[ann] || '';
}


// ═══════════════════════════════════════════════════════════════════════════
//  PRACTICE TAB
//  practiceGame (chess.js) is source of truth; practiceBoard mirrors its FEN.
//  In "vs Engine" mode, after the human moves, we queue Stockfish's reply.
// ═══════════════════════════════════════════════════════════════════════════

let practiceBoard;
let practiceGame = new Chess();
let playerColor  = 'w';
let practiceMode = 'engine';
/** Prevents double-clicks while engine is thinking (async callback in flight). */
let engineBusy   = false;

// An IIFE = Immediately Invoked Function Expression: (function(){ ... })();
// Runs once as soon as app.js loads so the practice board exists on first paint.
(function initPractice() {
  // 'practice-board' must match id="practice-board" in index.html exactly.
  practiceBoard = Chessboard('practice-board', {
    draggable: true,
    position: 'start',
    pieceTheme: PIECES,
    onDragStart,
    onDrop,
    // After animation, snap pieces to chess.js truth (illegal drops snap back)
    onSnapEnd: () => practiceBoard.position(practiceGame.fen()),
  });
  analyzeCurrentPos();
  tabInited['practice'] = true;
})();

/**
 * chessboard-js calls this before a drag starts; return false to cancel drag.
 * We block: wrong color, game over, engine thinking, or picking opponent piece.
 */
function onDragStart(source, piece) {
  if (practiceGame.game_over()) return false;
  if (practiceMode === 'engine') {
    if (engineBusy) return false;
    if (practiceGame.turn() !== playerColor) return false;
    if (playerColor === 'w' && /^b/.test(piece)) return false;
    if (playerColor === 'b' && /^w/.test(piece)) return false;
  }
  return true;
}

/**
 * After drop: chess.js validates; if illegal, return 'snapback' string.
 * Then refresh UI and maybe trigger engine move.
 */
function onDrop(source, target) {
  hlSquares('practice-board', null, null);
  const move = practiceGame.move({ from: source, to: target, promotion: 'q' });
  if (!move) return 'snapback';

  hlSquares('practice-board', source, target);
  refreshPracticeHistory();
  setPracticeStatus();

  if (practiceMode === 'engine' && !practiceGame.game_over()) {
    if (practiceGame.turn() !== playerColor) scheduleEngineMove();
  }

  analyzeCurrentPos();
}

/** Small delay feels natural and avoids UI jank before heavy worker work. */
function scheduleEngineMove() {
  engineBusy = true;
  setPracticeStatus('Engine thinking…');
  setTimeout(doEngineMove, 350);
}

function doEngineMove() {
  const depth = parseInt(document.getElementById('engine-depth').value);
  engine.analyze(practiceGame.fen(), depth, null, (uci) => {
    if (!uci) { engineBusy = false; return; }
    const from = uci.slice(0,2), to = uci.slice(2,4), promo = uci[4];
    practiceGame.move({ from, to, promotion: promo || 'q' });
    practiceBoard.position(practiceGame.fen());
    hlSquares('practice-board', from, to);
    refreshPracticeHistory();
    engineBusy = false;
    setPracticeStatus();
    analyzeCurrentPos();
  });
}

/**
 * Live analysis: deeper than play depth (+3) for steadier eval display.
 * onInfo: update eval bar + PV line; onDone: show best move in SAN.
 */
function analyzeCurrentPos() {
  if (practiceGame.game_over()) return;
  const depth = Math.min(parseInt(document.getElementById('engine-depth').value) + 3, 22);
  engine.analyze(practiceGame.fen(), depth,
    (info) => {
      if (!info.score) return;
      setEvalBar('eval-white', 'eval-label', info.score, practiceGame.turn());
      if (info.pv) showPV(info.pv, 'pv-line');
    },
    (uci) => {
      const san = engine.uciToSan(practiceGame, uci);
      document.getElementById('best-move').textContent = san || '—';
    }
  );
}

/** Convert first plies of UCI PV string to SAN for display using a throwaway Chess. */
function showPV(pvStr, elId) {
  const moves = pvStr.split(' ').slice(0, 8);
  const tmp = new Chess(practiceGame.fen());
  const sans = [];
  for (const uci of moves) {
    try {
      const m = tmp.move({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci[4] || 'q' });
      if (m) sans.push(m.san); else break;
    } catch (_) { break; }
  }
  document.getElementById(elId).textContent = sans.join(' ');
}

function refreshPracticeHistory() {
  const h = practiceGame.history();
  renderMoves('practice-history', h, -1, null, null);
  document.getElementById('practice-history').scrollTop = 9999;
}

function setPracticeStatus(msg) {
  const el = document.getElementById('practice-status');
  if (msg) { el.textContent = msg; return; }
  if (practiceGame.in_checkmate()) {
    el.textContent = practiceGame.turn() === 'w' ? 'Black wins by checkmate!' : 'White wins by checkmate!';
  } else if (practiceGame.in_stalemate()) {
    el.textContent = 'Draw by stalemate.';
  } else if (practiceGame.in_draw()) {
    el.textContent = 'Draw.';
  } else {
    el.textContent = practiceGame.turn() === 'w' ? 'White to move' : 'Black to move';
  }
}

// --- Practice controls ---
// Each line wires ONE HTML id to ONE event. The browser calls our function on click.
document.getElementById('new-game').addEventListener('click', () => {
  practiceGame = new Chess();
  practiceBoard.start();
  engineBusy = false;
  document.getElementById('practice-history').innerHTML = '';
  document.getElementById('best-move').textContent = '—';
  document.getElementById('pv-line').textContent = '';
  document.getElementById('eval-white').style.height = '50%';
  document.getElementById('eval-label').textContent = '0.0';
  setPracticeStatus();
  if (practiceMode === 'engine' && playerColor === 'b') scheduleEngineMove();
  else analyzeCurrentPos();
});

document.getElementById('flip-practice').addEventListener('click', () => practiceBoard.flip());

document.getElementById('undo-move').addEventListener('click', () => {
  if (practiceMode === 'engine') practiceGame.undo(); // pop engine reply
  practiceGame.undo(); // pop human move
  engineBusy = false;
  practiceBoard.position(practiceGame.fen());
  refreshPracticeHistory();
  setPracticeStatus();
  analyzeCurrentPos();
});

document.getElementById('play-white').addEventListener('click', function() {
  playerColor = 'w';
  this.classList.add('active');
  document.getElementById('play-black').classList.remove('active');
  practiceBoard.orientation('white');
});
document.getElementById('play-black').addEventListener('click', function() {
  playerColor = 'b';
  this.classList.add('active');
  document.getElementById('play-white').classList.remove('active');
  practiceBoard.orientation('black');
  if (practiceMode === 'engine' && practiceGame.history().length === 0) scheduleEngineMove();
});

document.getElementById('practice-mode').addEventListener('change', function() {
  practiceMode = this.value;
  engineBusy = false;
});

document.getElementById('engine-depth').addEventListener('input', function() {
  document.getElementById('depth-val').textContent = this.value;
});


// ═══════════════════════════════════════════════════════════════════════════
//  GAME REVIEW TAB
//  reviewPositions[i] = FEN after i plies (i=0 start). reviewIdx indexes it.
//  "Analyze Full Game" evals every position, then classifyMove per ply.
// ═══════════════════════════════════════════════════════════════════════════

let reviewBoard;
let reviewPositions = [];    // [{ fen, san, turn }]
let reviewIdx       = 0;
let reviewMoves     = [];    // SAN only, length = reviewPositions.length - 1
let reviewAnnotations = [];  // same length as reviewMoves; CSS classes

function initReview() {
  reviewBoard = Chessboard('review-board', {
    draggable: false,
    position: 'start',
    pieceTheme: PIECES,
  });
}

// async click handler: we can use `await` inside. While waiting for chess.com,
// the page stays responsive. try/catch turns network/API errors into a message
// in the list area instead of an uncaught error in the console.
document.getElementById('load-games').addEventListener('click', async () => {
  const user = document.getElementById('cc-username').value.trim();
  if (!user) return;
  const listEl = document.getElementById('games-list');
  listEl.innerHTML = '<div class="loading"><span class="spinner"></span>Loading…</div>';
  try {
    const games = await ChessCom.getRecentGames(user, 15);
    if (!games.length) { listEl.innerHTML = '<div class="loading">No games found.</div>'; return; }
    listEl.innerHTML = '';
    // forEach: run a function for every game in the array (no Express loop — plain JS).
    games.forEach(game => {
      const p = ChessCom.parseGameResult(game, user);
      const date = new Date(p.endTime * 1000).toLocaleDateString();
      const sym  = p.result === 'win' ? '✓' : p.result === 'loss' ? '✗' : '½';
      const cls  = p.result;
      // document.createElement builds a node in memory; appendChild attaches it to the DOM.
      const div  = document.createElement('div');
      div.className = 'game-card';
      div.innerHTML = `<div class="gp"><span class="${cls}">${sym}</span> ${p.myName} (${p.myRating}) vs ${p.oppName} (${p.oppRating})</div>
        <div class="gm">${date} · ${p.timeClass} · ${p.result.toUpperCase()}</div>`;
      div.addEventListener('click', () => loadGameForReview(game, p));
      listEl.appendChild(div);
    });
  } catch (e) {
    listEl.innerHTML = `<div class="loading" style="color:var(--red)">${e.message}</div>`;
  }
});

function loadGameForReview(game, parsed) {
  const hdrs = ChessCom.parsePGNHeaders(game.pgn);
  reviewPositions  = ChessCom.extractPositions(game.pgn);
  reviewMoves      = reviewPositions.slice(1).map(p => p.san);
  reviewAnnotations = [];
  reviewIdx        = 0;

  // Inline style overrides CSS: these panels start as display:none in index.html.
  document.getElementById('review-board-wrap').style.display = 'flex';
  document.getElementById('review-panel').style.display     = 'flex';
  document.getElementById('accuracy-card').style.display    = 'none';

  document.getElementById('game-info').innerHTML = `
    <b>White:</b> ${hdrs.White || '?'} (${parsed.isWhite ? parsed.myRating : parsed.oppRating})<br>
    <b>Black:</b> ${hdrs.Black || '?'} (${parsed.isWhite ? parsed.oppRating : parsed.myRating})<br>
    <b>Result:</b> ${hdrs.Result || '?'}<br>
    <b>Date:</b> ${hdrs.Date || '?'}<br>
    <b>Time:</b> ${parsed.timeClass}`;

  reviewBoard.position('start');
  renderMoves('review-moves', reviewMoves, 0, reviewAnnotations, goToReviewIdx);
  document.getElementById('analyze-progress').textContent = '';
  document.getElementById('review-board-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
  updateReviewEval();
}

function goToReviewIdx(idx) {
  if (idx < 0 || idx >= reviewPositions.length) return;
  reviewIdx = idx;
  const pos = reviewPositions[idx];
  reviewBoard.position(pos.fen);
  updateReviewEval();
  renderMoves('review-moves', reviewMoves, idx, reviewAnnotations, goToReviewIdx);
}

function updateReviewEval() {
  const pos = reviewPositions[reviewIdx];
  if (!pos) return;
  const turn = new Chess(pos.fen).turn();
  engine.analyze(pos.fen, 16,
    (info) => {
      if (info.score && info.depth >= 12) setEvalBar('rv-eval-white', 'rv-eval-label', info.score, turn);
    }, null
  );
}

document.getElementById('rv-first').addEventListener('click', () => goToReviewIdx(0));
document.getElementById('rv-prev').addEventListener('click',  () => goToReviewIdx(reviewIdx - 1));
document.getElementById('rv-next').addEventListener('click',  () => goToReviewIdx(reviewIdx + 1));
document.getElementById('rv-last').addEventListener('click',  () => goToReviewIdx(reviewPositions.length - 1));

// Global key listener: only acts when Review tab is active (guard clauses).
// e.preventDefault() stops the browser from scrolling the page when using arrows.
document.addEventListener('keydown', (e) => {
  if (!document.getElementById('tab-review').classList.contains('active')) return;
  if (!reviewPositions.length) return;
  if (e.key === 'ArrowLeft')  { e.preventDefault(); goToReviewIdx(reviewIdx - 1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); goToReviewIdx(reviewIdx + 1); }
});

// Sequential await in a for loop: each eval finishes before the next starts.
// This is simple but slow for long games — a server (Express + queue) could batch
// work, but this app keeps everything client-side for teaching clarity.
document.getElementById('analyze-game').addEventListener('click', async () => {
  if (!reviewPositions.length) return;
  const btn = document.getElementById('analyze-game');
  const prog = document.getElementById('analyze-progress');
  btn.disabled = true;
  btn.textContent = 'Analyzing…';

  const scores = [];
  for (let i = 0; i < reviewPositions.length; i++) {
    prog.textContent = `Analyzing position ${i} / ${reviewPositions.length - 1}…`;
    scores[i] = await engine.evalPosition(reviewPositions[i].fen, 16, 5000);
  }

  reviewAnnotations = [];
  const tally = { best:0, great:0, good:0, inaccuracy:0, mistake:0, blunder:0 };
  // Compare eval before vs after each move to label quality (engine.classifyMove).
  for (let i = 1; i < reviewPositions.length; i++) {
    const turn = reviewPositions[i - 1].turn;
    const ann  = engine.classifyMove(scores[i - 1], scores[i], turn);
    reviewAnnotations[i - 1] = ann;
    if (tally[ann] !== undefined) tally[ann]++;
  }

  renderMoves('review-moves', reviewMoves, reviewIdx, reviewAnnotations, goToReviewIdx);

  document.getElementById('accuracy-card').style.display = 'block';
  // .map builds an array of HTML strings; .join('') concatenates into one assignment.
  document.getElementById('accuracy-grid').innerHTML = [
    ['blunder','??','var(--red)'],
    ['mistake','?','var(--orange)'],
    ['inaccuracy','?!','var(--yellow)'],
    ['good','+','var(--green)'],
  ].map(([key,sym,col]) => `
    <div class="ac-item">
      <div class="ac-num" style="color:${col}">${tally[key]}</div>
      <div class="ac-lbl">${key}${sym}</div>
    </div>
  `).join('');

  btn.disabled = false;
  btn.textContent = 'Analyze Full Game';
  prog.textContent = 'Done!';
});


// ═══════════════════════════════════════════════════════════════════════════
//  PUZZLES TAB
//  We fetch FEN from chess.com, then build an engine "solution line" (UCI list).
//  Student moves must match the expected UCI at puzzleSolveIdx; on match we
//  auto-play the opponent reply from the same line.
// ═══════════════════════════════════════════════════════════════════════════

let puzzleBoard;
let puzzleGame       = new Chess();
let puzzleTurn       = 'w';
let puzzleEngineMoves = [];
let puzzleSolveIdx   = 0;
let puzzleSolved     = false;
let pSolved = 0, pTried = 0;

function initPuzzles() {
  puzzleBoard = Chessboard('puzzle-board', {
    draggable: true,
    position: 'start',
    pieceTheme: PIECES,
    onDragStart: puzzleDragStart,
    onDrop: puzzleDrop,
    onSnapEnd: () => puzzleBoard.position(puzzleGame.fen()),
  });
  fetchDailyPuzzle();
}

function puzzleDragStart(source, piece) {
  if (puzzleSolved || puzzleGame.game_over()) return false;
  if (puzzleGame.turn() !== puzzleTurn) return false;
  if (puzzleTurn === 'w' && /^b/.test(piece)) return false;
  if (puzzleTurn === 'b' && /^w/.test(piece)) return false;
  return true;
}

function puzzleDrop(source, target) {
  const move = puzzleGame.move({ from: source, to: target, promotion: 'q' });
  if (!move) return 'snapback';

  const madeUCI = source + target + (move.promotion || '');

  const expected = puzzleEngineMoves[puzzleSolveIdx];
  if (!expected) return;

  const matches = (madeUCI === expected) ||
    (source === expected.slice(0,2) && target === expected.slice(2,4));

  if (matches) {
    puzzleSolveIdx++;
    if (puzzleSolveIdx >= puzzleEngineMoves.length) {
      puzzleSolved = true;
      pSolved++;
      showFeedback('ok', '✓ Excellent! Puzzle solved!');
      updatePuzzleStats();
    } else {
      showFeedback('ok', '✓ Correct! Keep going…');
      setTimeout(() => {
        const oppUCI = puzzleEngineMoves[puzzleSolveIdx];
        if (oppUCI) {
          puzzleGame.move({ from: oppUCI.slice(0,2), to: oppUCI.slice(2,4), promotion: oppUCI[4] || 'q' });
          puzzleBoard.position(puzzleGame.fen());
          hlSquares('puzzle-board', oppUCI.slice(0,2), oppUCI.slice(2,4));
          puzzleSolveIdx++;
        }
        if (puzzleSolveIdx >= puzzleEngineMoves.length) {
          puzzleSolved = true; pSolved++;
          showFeedback('ok', '✓ Puzzle solved! Well done!');
          updatePuzzleStats();
        } else {
          showFeedback('', '');
        }
      }, 500);
    }
  } else {
    puzzleGame.undo();
    showFeedback('err', '✗ Not the best move. Try again!');
    return 'snapback';
  }
}

function showFeedback(type, msg) {
  const el = document.getElementById('puzzle-feedback');
  el.className = `feedback ${type}`;
  el.textContent = msg;
}

async function fetchDailyPuzzle() {
  setLoading('puzzle-title', 'Loading daily puzzle…');
  try {
    const data = await ChessCom.getDailyPuzzle();
    loadPuzzle(data, 'Daily Puzzle');
  } catch (e) {
    setLoading('puzzle-title', 'Error: ' + e.message);
  }
}

async function fetchRandomPuzzle() {
  setLoading('puzzle-title', 'Loading random puzzle…');
  try {
    const data = await ChessCom.getRandomPuzzle();
    loadPuzzle(data, 'Random Puzzle');
  } catch (e) {
    setLoading('puzzle-title', 'Error: ' + e.message);
  }
}

function setLoading(id, msg) { document.getElementById(id).textContent = msg; }

function loadPuzzle(data, label) {
  const { fen } = ChessCom.parsePuzzle(data);
  if (!fen) { setLoading('puzzle-title', 'Puzzle format not supported.'); return; }

  puzzleGame   = new Chess(fen);
  puzzleTurn   = puzzleGame.turn();
  puzzleSolved = false;
  puzzleEngineMoves = [];
  puzzleSolveIdx    = 0;

  document.getElementById('puzzle-title').textContent = data.title || label;
  document.getElementById('puzzle-side').textContent  = `${puzzleTurn === 'w' ? 'White' : 'Black'} to move`;
  document.getElementById('solution-card').style.display = 'none';
  showFeedback('', '');

  puzzleBoard.position(fen);
  puzzleBoard.orientation(puzzleTurn === 'w' ? 'white' : 'black');

  pTried++;
  updatePuzzleStats();

  buildPuzzleLine(fen, 3, []);
}

/**
 * Recursively extend best-play line in UCI. Async callbacks mean order can be
 * subtle; we pass lineSoFar to chain positions. movesLeft caps depth (3 plies).
 */
async function buildPuzzleLine(fen, movesLeft, lineSoFar) {
  if (movesLeft <= 0 || movesLeft > 6) return;
  const tmp = new Chess(fen);
  if (tmp.game_over()) return;

  engine.analyze(fen, 18, null, (uci) => {
    if (!uci) return;
    puzzleEngineMoves = [...lineSoFar, uci];
    if (movesLeft > 1) {
      const next = new Chess(fen);
      next.move({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci[4] || 'q' });
      if (!next.game_over()) buildPuzzleLine(next.fen(), movesLeft - 1, puzzleEngineMoves);
    }
  });
}

document.getElementById('daily-puzzle').addEventListener('click', fetchDailyPuzzle);
document.getElementById('random-puzzle').addEventListener('click', fetchRandomPuzzle);

document.getElementById('hint-btn').addEventListener('click', () => {
  const next = puzzleEngineMoves[puzzleSolveIdx];
  if (!next) return;
  const sq = next.slice(0, 2);
  showFeedback('tip', `Hint: move the piece on ${sq.toUpperCase()}`);
  $(`#puzzle-board .square-${sq}`).addClass('sq-hl-from');
  setTimeout(() => $(`#puzzle-board .square-${sq}`).removeClass('sq-hl-from'), 2000);
});

document.getElementById('show-solution').addEventListener('click', () => {
  const card = document.getElementById('solution-card');
  card.style.display = 'block';
  if (!puzzleEngineMoves.length) {
    document.getElementById('solution-text').textContent = 'Still computing best line…';
    return;
  }
  const tmp = new Chess(puzzleGame.fen());
  const sans = [];
  for (const uci of puzzleEngineMoves) {
    try {
      const m = tmp.move({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci[4] || 'q' });
      if (m) sans.push(m.san); else break;
    } catch (_) { break; }
  }
  document.getElementById('solution-text').textContent = sans.join(' → ') || puzzleEngineMoves.join(' ');
});

function updatePuzzleStats() {
  document.getElementById('p-solved').textContent = pSolved;
  document.getElementById('p-tried').textContent  = pTried;
  document.getElementById('p-pct').textContent    = pTried ? Math.round(pSolved / pTried * 100) + '%' : '—';
}


// ═══════════════════════════════════════════════════════════════════════════
//  OPENING EXPLORER TAB
//  openingsGame + openingsBoard; after each move we match UCI history against
//  the OPENINGS array in openings-db.js (plain data — no database, no Express).
//  updateContinuations() fills <div id="continuations"> with clickable rows
//  built from strings (same innerHTML pattern as renderMoves).
// ═══════════════════════════════════════════════════════════════════════════

let openingsBoard;
let openingsGame = new Chess();

function initOpenings() {
  openingsBoard = Chessboard('openings-board', {
    draggable: true,
    position: 'start',
    pieceTheme: PIECES,
    onDragStart: () => !openingsGame.game_over(),
    onDrop: openingsDrop,
    onSnapEnd: () => openingsBoard.position(openingsGame.fen()),
  });
  updateOpeningInfo();
}

function openingsDrop(source, target) {
  const move = openingsGame.move({ from: source, to: target, promotion: 'q' });
  if (!move) return 'snapback';
  hlSquares('openings-board', source, target);
  updateOpeningHistory();
  updateOpeningInfo();
}

function updateOpeningInfo() {
  const history = openingsGame.history({ verbose: true });
  const uciMoves = history.map(m => m.from + m.to + (m.promotion || ''));
  const entry = lookupOpening(uciMoves);

  if (entry) {
    document.getElementById('opening-name').textContent = entry.name;
    document.getElementById('opening-eco').textContent  = `ECO: ${entry.eco}`;
    document.getElementById('opening-desc').textContent = entry.desc;
  } else if (!history.length) {
    document.getElementById('opening-name').textContent = 'Starting Position';
    document.getElementById('opening-eco').textContent  = '';
    document.getElementById('opening-desc').textContent = 'Make a move to explore openings.';
  } else {
    document.getElementById('opening-name').textContent = 'Unknown / Out of Book';
    document.getElementById('opening-eco').textContent  = '';
    document.getElementById('opening-desc').textContent = 'This position is not in our database.';
  }

  updateContinuations(uciMoves);
}

function updateContinuations(uciMoves) {
  const conts = getContinuations(uciMoves);
  const container = document.getElementById('continuations');

  if (!conts.length) {
    container.innerHTML = '<div class="hint">No recorded continuations</div>';
    return;
  }

  container.innerHTML = conts.map(c => {
    const tmp = new Chess(openingsGame.fen());
    let san = c.uci;
    try {
      const m = tmp.move({ from: c.uci.slice(0,2), to: c.uci.slice(2,4), promotion: c.uci[4] || 'q' });
      if (m) san = m.san;
    } catch (_) {}
    return `<div class="cont-item" data-uci="${c.uci}">
      <span class="cont-move">${san}</span>
      <span class="cont-name">${c.name}</span>
    </div>`;
  }).join('');

  container.querySelectorAll('.cont-item').forEach(el => {
    el.addEventListener('click', () => {
      const uci = el.dataset.uci;
      const move = openingsGame.move({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci[4] || 'q' });
      if (!move) return;
      openingsBoard.position(openingsGame.fen());
      hlSquares('openings-board', uci.slice(0,2), uci.slice(2,4));
      updateOpeningHistory();
      updateOpeningInfo();
    });
  });
}

function updateOpeningHistory() {
  const h = openingsGame.history();
  renderMoves('opening-history', h, -1, null, null);
}

document.getElementById('op-back').addEventListener('click', () => {
  openingsGame.undo();
  openingsBoard.position(openingsGame.fen());
  updateOpeningHistory();
  updateOpeningInfo();
});
document.getElementById('op-reset').addEventListener('click', () => {
  openingsGame = new Chess();
  openingsBoard.start();
  document.getElementById('opening-history').innerHTML = '';
  updateOpeningInfo();
});
document.getElementById('op-flip').addEventListener('click', () => openingsBoard.flip());
