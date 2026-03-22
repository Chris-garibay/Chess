/**
 * ============================================================================
 * openings-db.js — small opening "book" for the Openings tab
 * ============================================================================
 * TEACHING NOTES:
 *
 * - ECO = Encyclopedia of Chess Openings classification (codes like B90, C60).
 * - Moves here are stored in *UCI* (e2e4 not "e4") so we can match chess.js
 *   verbose history: from+to+promotion.
 * - OPENINGS is sorted **longest line first** (see .sort at bottom). Why?
 *   When several entries share a prefix (e.g. 1.e4 e5 vs full Ruy line),
 *   we want the *most specific* (longest matching sequence) to win in lookupOpening().
 *
 * - lookupOpening(uciMoves): given the sequence of moves played so far, find the
 *   best matching book entry (if any).
 *
 * - getContinuations(uciMoves): find all book lines that extend the current
 *   sequence by exactly one move — used to populate the "Continuations" list.
 *
 * This is data-driven: students can add new objects to OPENINGS to extend the book.
 * ============================================================================
 */

/**
 * @typedef {Object} OpeningEntry
 * @property {string[]} moves - full UCI sequence from start position
 * @property {string} eco - ECO code
 * @property {string} name - human-readable opening name
 * @property {string} desc - short teaching blurb
 */

const OPENINGS = [
  // ── 1.e4 family ───────────────────────────────────────────────────────
  { moves:['e2e4'], eco:'B00', name:"King's Pawn", desc:"Controls the center immediately. One of the most popular first moves, leading to open, tactical games." },

  { moves:['e2e4','e7e5'], eco:'C20', name:"Open Game", desc:"Symmetric center. Both sides fight directly for the middle." },
  { moves:['e2e4','e7e5','g1f3'], eco:'C40', name:"King's Knight Opening", desc:"White develops the knight and attacks e5." },
  { moves:['e2e4','e7e5','g1f3','b8c6'], eco:'C44', name:"Double King's Pawn", desc:"Black defends with the most natural move." },

  { moves:['e2e4','e7e5','g1f3','b8c6','f1b5'], eco:'C60', name:"Ruy López (Spanish)", desc:"A cornerstone of chess theory. White pins the defender of e5 and aims for a long-term positional edge." },
  { moves:['e2e4','e7e5','g1f3','b8c6','f1b5','a7a6'], eco:'C65', name:"Ruy López: Morphy Defense", desc:"The most popular reply — Black challenges the bishop immediately." },
  { moves:['e2e4','e7e5','g1f3','b8c6','f1b5','a7a6','f1a4','g8f6','e1g1'], eco:'C80', name:"Ruy López: Open Variation", desc:"After castling, 5…Nxe4 leads to sharp, tactical play." },

  { moves:['e2e4','e7e5','g1f3','b8c6','f1c4'], eco:'C50', name:"Italian Game", desc:"Targets f7 and aims for rapid development. A classical, principled opening." },
  { moves:['e2e4','e7e5','g1f3','b8c6','f1c4','f8c5'], eco:'C51', name:"Italian: Giuoco Piano", desc:"The 'Quiet Game'. Both sides mirror development before complications arise." },
  { moves:['e2e4','e7e5','g1f3','b8c6','f1c4','g8f6'], eco:'C55', name:"Two Knights Defense", desc:"Black fights back actively instead of passive defense." },
  { moves:['e2e4','e7e5','g1f3','b8c6','f1c4','g8f6','d2d4'], eco:'C56', name:"Two Knights: Modern Attack", desc:"White sacrifices a pawn for central control and an attack." },

  { moves:['e2e4','e7e5','g1f3','g8f6'], eco:'C42', name:"Petrov's Defense", desc:"Black counterattacks immediately. A solid, symmetrical defense often leading to draws at the top level." },
  { moves:['e2e4','e7e5','f2f4'], eco:'C30', name:"King's Gambit", desc:"A romantic, aggressive pawn sacrifice for rapid piece development and a kingside attack." },
  { moves:['e2e4','e7e5','f2f4','e5f4'], eco:'C33', name:"King's Gambit Accepted", desc:"Black accepts the pawn, entering one of the sharpest positions in chess." },

  { moves:['e2e4','e7e5','g1f3','b8c6','d2d4'], eco:'C44', name:"Scotch Game", desc:"White opens the center immediately, leading to sharp tactical battles." },
  { moves:['e2e4','e7e5','g1f3','b8c6','d2d4','e5d4','g1d4'], eco:'C45', name:"Scotch Game: Main Line", desc:"White recaptures with the knight, maintaining central tension." },

  // ── Sicilian ─────────────────────────────────────────────────────────
  { moves:['e2e4','c7c5'], eco:'B20', name:"Sicilian Defense", desc:"The most popular response to 1.e4. Black creates asymmetry immediately, fighting for the center indirectly." },
  { moves:['e2e4','c7c5','g1f3'], eco:'B23', name:"Sicilian: Open Variation Setup", desc:"White prepares d4 to open the game." },
  { moves:['e2e4','c7c5','g1f3','d7d6','d2d4','c5d4','g1d4'], eco:'B50', name:"Sicilian: Classical", desc:"The main line Sicilian. Black's d6 pawn supports e5 and prepares …Nf6." },
  { moves:['e2e4','c7c5','g1f3','d7d6','d2d4','c5d4','g1d4','g8f6','b1c3','g7g6'], eco:'B70', name:"Sicilian Dragon", desc:"Black fianchettoes the bishop for powerful long-diagonal pressure. Ultra-sharp double-edged play." },
  { moves:['e2e4','c7c5','g1f3','d7d6','d2d4','c5d4','g1d4','g8f6','b1c3','a7a6'], eco:'B90', name:"Sicilian Najdorf", desc:"The most popular Sicilian. Named after Grandmaster Miguel Najdorf. Extremely rich and complex theory." },
  { moves:['e2e4','c7c5','g1f3','e7e6'], eco:'B40', name:"Sicilian: French Variation", desc:"Solid setup combining Sicilian and French ideas." },
  { moves:['e2e4','c7c5','g1f3','b8c6'], eco:'B56', name:"Sicilian: Classical Variation", desc:"Natural development, keeping options open." },
  { moves:['e2e4','c7c5','c2c3'], eco:'B22', name:"Sicilian: Alapin Variation", desc:"2.c3 avoids main Sicilian theory and aims for a strong center." },

  // ── French ───────────────────────────────────────────────────────────
  { moves:['e2e4','e7e6'], eco:'C00', name:"French Defense", desc:"Solid and counterattacking. Black builds a pawn chain and fights back with …d5." },
  { moves:['e2e4','e7e6','d2d4','d7d5'], eco:'C01', name:"French Defense: Exchange", desc:"White can exchange pawns for a symmetrical, quieter game." },
  { moves:['e2e4','e7e6','d2d4','d7d5','b1c3'], eco:'C10', name:"French: Winawer / Classical", desc:"White defends e4. Leads to the rich Winawer or Classical variations." },
  { moves:['e2e4','e7e6','d2d4','d7d5','b1c3','f8b4'], eco:'C15', name:"French: Winawer Variation", desc:"Black pins the knight. Creates highly unbalanced pawn structures." },

  // ── Caro-Kann ────────────────────────────────────────────────────────
  { moves:['e2e4','c7c6'], eco:'B10', name:"Caro-Kann Defense", desc:"Solid and reliable. Black prepares …d5 without weakening the pawn structure." },
  { moves:['e2e4','c7c6','d2d4','d7d5'], eco:'B13', name:"Caro-Kann: Main Line", desc:"After 2.d4 d5 white must decide how to maintain the tension." },
  { moves:['e2e4','c7c6','d2d4','d7d5','b1c3'], eco:'B15', name:"Caro-Kann: Classical", desc:"3.Nc3 is one of the main lines, leading to solid but complex play." },
  { moves:['e2e4','c7c6','d2d4','d7d5','e4e5'], eco:'B12', name:"Caro-Kann: Advance Variation", desc:"White advances, gaining space. Modern and aggressive." },

  // ── Scandinavian ─────────────────────────────────────────────────────
  { moves:['e2e4','d7d5'], eco:'B01', name:"Scandinavian Defense", desc:"Black immediately challenges the center. 2.exd5 is the principled reply." },

  // ── Pirc / Modern ────────────────────────────────────────────────────
  { moves:['e2e4','d7d6'], eco:'B07', name:"Pirc Defense", desc:"Hypermodern. Black allows white to build a center then attacks it." },
  { moves:['e2e4','g7g6'], eco:'B06', name:"Modern Defense", desc:"Flexible hypermodern setup. Black delays commitment." },

  // ── 1.d4 ─────────────────────────────────────────────────────────────
  { moves:['d2d4'], eco:'A40', name:"Queen's Pawn Opening", desc:"Solid, strategic first move. Leads to a huge variety of closed and semi-open games." },

  { moves:['d2d4','d7d5'], eco:'D05', name:"Closed Game", desc:"Symmetric pawn center battle." },
  { moves:['d2d4','d7d5','c2c4'], eco:'D06', name:"Queen's Gambit", desc:"White offers a pawn for rapid development and central control. One of the oldest openings." },
  { moves:['d2d4','d7d5','c2c4','e7e6'], eco:'D30', name:"Queen's Gambit Declined", desc:"Solid and classical. Black reinforces d5 and prepares to fight back." },
  { moves:['d2d4','d7d5','c2c4','d5c4'], eco:'D20', name:"Queen's Gambit Accepted", desc:"Black grabs the pawn, releasing central tension. White regains it with good development." },
  { moves:['d2d4','d7d5','c2c4','c7c6'], eco:'D10', name:"Slav Defense", desc:"Rock-solid defense keeping the c8 bishop active. Very popular at all levels." },
  { moves:['d2d4','d7d5','c2c4','c7c6','g1f3','g8f6'], eco:'D14', name:"Slav: Main Line", desc:"Both sides develop naturally. Rich and deeply studied theory." },

  // ── Indian Defenses ──────────────────────────────────────────────────
  { moves:['d2d4','g8f6'], eco:'A45', name:"Indian Defense", desc:"Black controls the center with pieces. Hypermodern." },
  { moves:['d2d4','g8f6','c2c4'], eco:'E00', name:"Indian System", desc:"Flexible move order allowing KID, QID, Nimzo, and Bogo variations." },

  { moves:['d2d4','g8f6','c2c4','g7g6'], eco:'E60', name:"King's Indian Defense", desc:"Black cedes the center, then storms it with …e5 or …c5. Dynamic, double-edged play." },
  { moves:['d2d4','g8f6','c2c4','g7g6','b1c3','f8g7','e2e4'], eco:'E70', name:"King's Indian: Main Lines", desc:"4.e4 is the classical setup. Leads to very sharp, complex positions." },
  { moves:['d2d4','g8f6','c2c4','g7g6','b1c3','f8g7','e2e4','d7d6','g1f3','e8g8'], eco:'E90', name:"King's Indian: Classical", desc:"The main battleground of the KID." },

  { moves:['d2d4','g8f6','c2c4','e7e6'], eco:'E10', name:"Queen's Indian Setup", desc:"Flexible — can lead to QID, Nimzo, or Bogo-Indian." },
  { moves:['d2d4','g8f6','c2c4','e7e6','b1c3','f8b4'], eco:'E20', name:"Nimzo-Indian Defense", desc:"One of the most respected defenses. Black pins the knight and fights for the center." },
  { moves:['d2d4','g8f6','c2c4','e7e6','g1f3','b7b6'], eco:'E12', name:"Queen's Indian Defense", desc:"Fianchetto on the queenside. Flexible and solid with counterplay." },

  { moves:['d2d4','g8f6','c2c4','c7c5'], eco:'A56', name:"Benoni Defense", desc:"Sharp! Black fights for the center with …e5 coming. Dynamic counterplay." },
  { moves:['d2d4','g8f6','c2c4','c7c5','d4d5','e7e5'], eco:'A67', name:"Modern Benoni", desc:"Black accepts a backward d6 pawn for dynamic piece play and the …e5 break." },

  { moves:['d2d4','f7f5'], eco:'A80', name:"Dutch Defense", desc:"Black controls e4 immediately. Aggressive and uncompromising." },
  { moves:['d2d4','f7f5','c2c4','e7e6','g2g3'], eco:'A87', name:"Dutch: Classical", desc:"White fianchettoes. Leads to rich strategic battles." },

  // ── English / Réti ───────────────────────────────────────────────────
  { moves:['c2c4'], eco:'A10', name:"English Opening", desc:"Controls d5 from the flank. Very flexible — can transpose to many queen's pawn positions." },
  { moves:['c2c4','e7e5'], eco:'A20', name:"English: King's English", desc:"Black answers symmetrically. Leads to rich strategic battles." },
  { moves:['c2c4','c7c5'], eco:'A30', name:"English: Symmetrical Variation", desc:"Both sides build symmetrical pawn structures. Very solid." },

  { moves:['g1f3'], eco:'A04', name:"Réti Opening", desc:"Hypermodern — White controls the center with pieces before committing pawns." },
  { moves:['g1f3','d7d5','c2c4'], eco:'A09', name:"Réti: Main Line", desc:"After …d5 c4, white can transpose to QGD or play independently." },

  // ── Bird's Opening ───────────────────────────────────────────────────
  { moves:['f2f4'], eco:'A02', name:"Bird's Opening", desc:"Controls e5 from the flank. Can lead to reversed Dutch positions." },
].sort((a, b) => b.moves.length - a.moves.length); // CRITICAL: longest lines first for lookup

/**
 * Find the most specific opening line that matches the moves played so far.
 * Because OPENINGS is sorted longest-first, the first match is the deepest line.
 *
 * @param {string[]} uciMoves - e.g. ['e2e4','e7e5','g1f3']
 * @returns {OpeningEntry|null}
 */
function lookupOpening(uciMoves) {
  for (const entry of OPENINGS) {
    if (entry.moves.length > uciMoves.length) continue;
    if (entry.moves.every((m, i) => uciMoves[i] === m)) return entry;
  }
  return null;
}

/**
 * All book moves that continue the current line by exactly one ply.
 * Dedupes with `seen` when two named lines share the same next UCI.
 *
 * @param {string[]} uciMoves - current sequence from start position
 * @returns {{uci: string, name: string}[]}
 */
function getContinuations(uciMoves) {
  const results = [];
  const seen = new Set();
  for (const entry of OPENINGS) {
    if (entry.moves.length !== uciMoves.length + 1) continue;
    if (!entry.moves.slice(0, uciMoves.length).every((m, i) => uciMoves[i] === m)) continue;
    const next = entry.moves[uciMoves.length];
    if (!seen.has(next)) { seen.add(next); results.push({ uci: next, name: entry.name }); }
  }
  return results;
}
