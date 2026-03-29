/**
 * ============================================================================
 * chesscom.js — chess.com public (unauthenticated) HTTP API
 * ============================================================================
 *
 * IF YOU EXPECTED EXPRESS: THIS FILE IS STILL BROWSER JAVASCRIPT
 * - In many tutorials, the *server* (often written with Express in Node.js)
 *   calls other APIs and hides secret keys. Here there is no secret key: the
 *   chess.com endpoints are *public*, so the browser can call them directly
 *   with fetch().
 * - fetch('https://api.chess.com/...') goes from the user's browser straight
 *   to chess.com (subject to CORS rules). No app.get('/games') on your machine
 *   unless you build that yourself as a separate project.
 *
 * async / await (READ THIS IF IT LOOKS STRANGE)
 * - Network requests take time. fetch does not freeze the page; it returns a
 *   Promise. `await fetch(...)` means "pause *this function* until the
 *   response arrives, then continue". The function must be marked `async`.
 * - `.json()` also returns a Promise — we await it to get a plain JavaScript
 *   object from the HTTP body.
 *
 * OTHER NOTES
 * - Rate limits and CORS still apply. Opening index.html as file:// sometimes
 *   breaks fetch; use a simple static server (e.g. `npx serve`) for class demos.
 * - PGN = text format for games: headers in [brackets], then moves. chess.js
 *   loads PGN and can replay moves to produce FEN at each step.
 *
 * Global: ChessCom — used by app.js for games list, daily puzzle, etc.
 * ============================================================================
 */
const ChessCom = {
  /** Base URL for all paths below */
  base: 'https://api.chess.com/pub',

  /**
   * List recent games for a username.
   * Flow: (1) GET archives → list of monthly JSON URLs; (2) walk newest months,
   * merge games until we have `limit`. Archives are oldest-first; we reverse
   * so the student sees newest games first.
   *
   * @param {string} username - chess.com handle (case-insensitive on their side)
   * @param {number} limit - max games to return
   * @returns {Promise<object[]>} raw game objects (include .pgn, .white, .black, …)
   */
  async getRecentGames(username, limit = 20) {
    const archRes = await fetch(`${this.base}/player/${encodeURIComponent(username)}/games/archives`);
    if (!archRes.ok) throw new Error(`Player "${username}" not found`);
    const { archives = [] } = await archRes.json();
    if (!archives.length) return [];

    // Each archive URL returns { games: [...] } for one month
    let games = [];
    for (let i = archives.length - 1; i >= 0 && games.length < limit; i--) {
      const r = await fetch(archives[i]);
      if (!r.ok) continue;
      const data = await r.json();
      games = [...(data.games || []), ...games];
    }
    return games.slice(-limit).reverse(); // most recent first
  },

  /**
   * Daily puzzle: returns JSON with title, fen, pgn, url, etc.
   * @returns {Promise<{title?: string, fen?: string, pgn?: string, ...}>}
   */
  async getDailyPuzzle() {
    const r = await fetch(`${this.base}/puzzle`);
    if (!r.ok) throw new Error('Could not load daily puzzle');
    return r.json();
  },

  /** Random puzzle from the same API family as daily. */
  async getRandomPuzzle() {
    const r = await fetch(`${this.base}/puzzle/random`);
    if (!r.ok) throw new Error('Could not load random puzzle');
    return r.json();
  },

  /**
   * From one API game object, compute result *for the student* (win/loss/draw),
   * colors, ratings, and metadata for UI cards.
   *
   * @param {object} game - chess.com game payload
   * @param {string} username - student username to match
   */
  parseGameResult(game, username) {
    const lc = username.toLowerCase();
    const isWhite = game.white.username.toLowerCase() === lc;
    const me  = isWhite ? game.white : game.black;
    const opp = isWhite ? game.black : game.white;

    let result = 'draw';
    if (me.result === 'win') result = 'win';
    else if (opp.result === 'win') result = 'loss';

    return {
      result,
      isWhite,
      myName:       me.username,
      oppName:      opp.username,
      myRating:     me.rating,
      oppRating:    opp.rating,
      timeClass:    game.time_class,
      endTime:      game.end_time,
      pgn:          game.pgn,
    };
  },

  /**
   * Parse [Key "Value"] headers from the top of a PGN string.
   * Regex captures tag name and quoted value for each header line.
   */
  parsePGNHeaders(pgn) {
    const headers = {};
    const re = /\[(\w+)\s+"([^"]*)"\]/g;
    let m;
    while ((m = re.exec(pgn)) !== null) headers[m[1]] = m[2];
    return headers;
  },

  /**
   * Build a timeline of positions for the review board.
   * Steps through every legal move in the PGN; after each ply we store FEN.
   *
   * @param {string} pgn - full game PGN
   * @returns {{fen: string, san: string|null, turn: 'w'|'b'}[]}
   *   Index 0 = start position (san null). Later entries: san is the move
   *   *just played*; turn is who moved (stored as side that was on move before the move).
   */
  extractPositions(pgn) {
    const chess = new Chess();
    try { chess.load_pgn(pgn); } catch (_) { return []; }
    const history = chess.history({ verbose: true });

    chess.reset();
    const positions = [{ fen: chess.fen(), san: null, turn: 'w' }];
    for (const mv of history) {
      const turnBefore = chess.turn(); // who is about to move = side making this ply
      chess.move(mv.san);
      positions.push({ fen: chess.fen(), san: mv.san, turn: turnBefore });
    }
    return positions;
  },

  /**
   * Normalize puzzle API payload for app.js.
   * Primary: use API-provided FEN when present.
   * Secondary: replay PGN to get final FEN (setup moves end in puzzle position).
   *
   * Note: chess.com does not ship the full solution line in a simple UCI array
   * here — app.js uses Stockfish to build a "best line" for hints/validation.
   */
  parsePuzzle(data) {
    const fen = data.fen || null;

    let puzzleFen = fen;
    let solutionUCI = [];

    if (data.pgn) {
      const chess = new Chess();
      try {
        chess.load_pgn(data.pgn);
        puzzleFen = chess.fen();
      } catch (_) {}

      // Intentionally empty: solution comes from engine in app.js (buildPuzzleLine)
    }

    return { fen: puzzleFen, solutionUCI };
  }
};
