// Curated reading list per Codeforces tag. The coach may only recommend by id from here.
// URLs checked with curl on 2026-11-20 (HTTP 200 + <title> matched). Entries with verified:false
// are Codeforces EDU lessons behind Cloudflare (403 to automated checks); their ids are the
// well-known ITMO Academy course/2 lesson ids.

export interface Resource { id: string; tag: string; title: string; url: string; kind: 'article' | 'course' | 'problems' | 'guide'; tier: [number, number]; minutes: number; verified: boolean }

export const RESOURCES: Resource[] = [
  // general
  { id: 'usaco-general-practicing', tag: 'general', title: 'How to Practice (USACO Guide)', url: 'https://usaco.guide/general/practicing', kind: 'guide', tier: [800, 2400], minutes: 20, verified: true },
  { id: 'usaco-general-debugging', tag: 'general', title: 'How to Debug (USACO Guide)', url: 'https://usaco.guide/general/debugging-checklist', kind: 'guide', tier: [800, 2400], minutes: 15, verified: true },
  { id: 'usaco-general-contest-strategy', tag: 'general', title: 'Contest Strategy (USACO Guide)', url: 'https://usaco.guide/general/contest-strategy', kind: 'guide', tier: [1000, 2400], minutes: 15, verified: true },
  { id: 'cses-problemset', tag: 'general', title: 'CSES Problem Set', url: 'https://cses.fi/problemset/', kind: 'problems', tier: [1000, 2200], minutes: 60, verified: true },
  { id: 'cses-book', tag: 'general', title: "Competitive Programmer's Handbook (Antti Laaksonen, PDF)", url: 'https://cses.fi/book/book.pdf', kind: 'guide', tier: [1000, 2000], minutes: 60, verified: true },
  { id: 'cfedu-courses', tag: 'general', title: 'Courses - Codeforces EDU', url: 'https://codeforces.com/edu/courses', kind: 'course', tier: [1200, 2200], minutes: 10, verified: true },

  // greedy
  { id: 'usaco-bronze-intro-greedy', tag: 'greedy', title: 'Introduction to Greedy Algorithms (USACO Guide)', url: 'https://usaco.guide/bronze/intro-greedy', kind: 'guide', tier: [800, 1300], minutes: 25, verified: true },
  { id: 'usaco-silver-greedy-sorting', tag: 'greedy', title: 'Greedy Algorithms with Sorting (USACO Guide)', url: 'https://usaco.guide/silver/greedy-sorting', kind: 'guide', tier: [1100, 1700], minutes: 40, verified: true },
  { id: 'cpa-schedule-one-machine', tag: 'greedy', title: 'Scheduling jobs on one machine (cp-algorithms)', url: 'https://cp-algorithms.com/schedules/schedule_one_machine.html', kind: 'article', tier: [1600, 2200], minutes: 20, verified: true },

  // math
  { id: 'cpa-binary-exp', tag: 'math', title: 'Binary Exponentiation (cp-algorithms)', url: 'https://cp-algorithms.com/algebra/binary-exp.html', kind: 'article', tier: [1000, 1600], minutes: 20, verified: true },
  { id: 'usaco-gold-modular', tag: 'math', title: 'Modular Arithmetic (USACO Guide)', url: 'https://usaco.guide/gold/modular', kind: 'guide', tier: [1100, 1700], minutes: 30, verified: true },
  { id: 'cpa-module-inverse', tag: 'math', title: 'Modular Inverse (cp-algorithms)', url: 'https://cp-algorithms.com/algebra/module-inverse.html', kind: 'article', tier: [1400, 2000], minutes: 20, verified: true },
  { id: 'cses-mathematics', tag: 'math', title: 'CSES Problem Set: Mathematics section', url: 'https://cses.fi/problemset/task/2164', kind: 'problems', tier: [1400, 2200], minutes: 120, verified: true },

  // constructive algorithms
  { id: 'usaco-bronze-ad-hoc', tag: 'constructive algorithms', title: 'Ad Hoc Problems (USACO Guide)', url: 'https://usaco.guide/bronze/ad-hoc', kind: 'guide', tier: [800, 1500], minutes: 30, verified: true },
  { id: 'cses-construction', tag: 'constructive algorithms', title: 'CSES Problem Set: Construction Problems section', url: 'https://cses.fi/problemset/task/2214', kind: 'problems', tier: [1300, 2100], minutes: 120, verified: true },

  // implementation
  { id: 'usaco-bronze-simulation', tag: 'implementation', title: 'Simulation (USACO Guide)', url: 'https://usaco.guide/bronze/simulation', kind: 'guide', tier: [800, 1200], minutes: 20, verified: true },
  { id: 'usaco-bronze-time-comp', tag: 'implementation', title: 'Time Complexity (USACO Guide)', url: 'https://usaco.guide/bronze/time-comp', kind: 'guide', tier: [800, 1300], minutes: 20, verified: true },
  { id: 'usaco-bronze-casework', tag: 'implementation', title: 'Casework (USACO Guide)', url: 'https://usaco.guide/bronze/casework', kind: 'guide', tier: [900, 1400], minutes: 20, verified: true },
  { id: 'cses-introductory', tag: 'implementation', title: 'CSES Problem Set: Introductory Problems section', url: 'https://cses.fi/problemset/task/1068', kind: 'problems', tier: [800, 1400], minutes: 120, verified: true },
  { id: 'usaco-general-fast-io', tag: 'implementation', title: 'Fast Input & Output (USACO Guide)', url: 'https://usaco.guide/general/fast-io', kind: 'guide', tier: [800, 1600], minutes: 10, verified: true },

  // brute force
  { id: 'usaco-bronze-intro-complete', tag: 'brute force', title: 'Basic Complete Search (USACO Guide)', url: 'https://usaco.guide/bronze/intro-complete', kind: 'guide', tier: [800, 1200], minutes: 20, verified: true },
  { id: 'usaco-bronze-complete-rec', tag: 'brute force', title: 'Complete Search with Recursion (USACO Guide)', url: 'https://usaco.guide/bronze/complete-rec', kind: 'guide', tier: [900, 1400], minutes: 30, verified: true },
  { id: 'usaco-gold-meet-in-the-middle', tag: 'brute force', title: '(Optional) Meet In The Middle (USACO Guide)', url: 'https://usaco.guide/gold/meet-in-the-middle', kind: 'guide', tier: [1600, 2200], minutes: 30, verified: true },

  // sortings
  { id: 'usaco-bronze-intro-sorting', tag: 'sortings', title: 'Introduction to Sorting (USACO Guide)', url: 'https://usaco.guide/bronze/intro-sorting', kind: 'guide', tier: [800, 1200], minutes: 15, verified: true },
  { id: 'usaco-silver-sorting-custom', tag: 'sortings', title: 'Custom Comparators and Coordinate Compression (USACO Guide)', url: 'https://usaco.guide/silver/sorting-custom', kind: 'guide', tier: [1100, 1600], minutes: 30, verified: true },
  { id: 'cses-sorting', tag: 'sortings', title: 'CSES Problem Set: Sorting and Searching section', url: 'https://cses.fi/problemset/task/1621', kind: 'problems', tier: [1000, 1900], minutes: 180, verified: true },

  // strings
  { id: 'cpa-z-function', tag: 'strings', title: 'Z-function (cp-algorithms)', url: 'https://cp-algorithms.com/string/z-function.html', kind: 'article', tier: [1500, 2100], minutes: 30, verified: true },
  { id: 'cpa-prefix-function', tag: 'strings', title: 'Prefix function - Knuth-Morris-Pratt (cp-algorithms)', url: 'https://cp-algorithms.com/string/prefix-function.html', kind: 'article', tier: [1600, 2200], minutes: 40, verified: true },
  { id: 'usaco-adv-string-search', tag: 'strings', title: 'String Searching (USACO Guide)', url: 'https://usaco.guide/adv/string-search', kind: 'guide', tier: [1700, 2300], minutes: 40, verified: true },
  { id: 'cses-strings', tag: 'strings', title: 'CSES Problem Set: String Algorithms section', url: 'https://cses.fi/problemset/task/1731', kind: 'problems', tier: [1600, 2300], minutes: 180, verified: true },
  { id: 'cfedu-suffix-array', tag: 'strings', title: 'ITMO Academy: pilot course, Suffix Array (Codeforces EDU)', url: 'https://codeforces.com/edu/course/2/lesson/2', kind: 'course', tier: [1900, 2500], minutes: 180, verified: false },

  // binary search
  { id: 'usaco-silver-binary-search', tag: 'binary search', title: 'Binary Search (USACO Guide)', url: 'https://usaco.guide/silver/binary-search', kind: 'guide', tier: [1100, 1700], minutes: 40, verified: true },
  { id: 'cpa-binary-search', tag: 'binary search', title: 'Binary Search (cp-algorithms)', url: 'https://cp-algorithms.com/num_methods/binary_search.html', kind: 'article', tier: [1200, 1800], minutes: 25, verified: true },
  { id: 'cfedu-binary-search', tag: 'binary search', title: 'ITMO Academy: pilot course, Binary Search (Codeforces EDU)', url: 'https://codeforces.com/edu/course/2/lesson/6', kind: 'course', tier: [1200, 1900], minutes: 180, verified: false },
  { id: 'cpa-ternary-search', tag: 'binary search', title: 'Ternary Search (cp-algorithms)', url: 'https://cp-algorithms.com/num_methods/ternary_search.html', kind: 'article', tier: [1600, 2100], minutes: 20, verified: true },

  // two pointers
  { id: 'usaco-silver-two-pointers', tag: 'two pointers', title: 'Two Pointers (USACO Guide)', url: 'https://usaco.guide/silver/two-pointers', kind: 'guide', tier: [1100, 1600], minutes: 30, verified: true },
  { id: 'usaco-gold-sliding-window', tag: 'two pointers', title: 'Sliding Window (USACO Guide)', url: 'https://usaco.guide/gold/sliding-window', kind: 'guide', tier: [1300, 1900], minutes: 30, verified: true },
  { id: 'cfedu-two-pointers', tag: 'two pointers', title: 'ITMO Academy: pilot course, Two Pointers Method (Codeforces EDU)', url: 'https://codeforces.com/edu/course/2/lesson/9', kind: 'course', tier: [1200, 1900], minutes: 180, verified: false },
  { id: 'cses-sliding-window', tag: 'two pointers', title: 'CSES Problem Set: Sliding Window Problems section', url: 'https://cses.fi/problemset/task/3220', kind: 'problems', tier: [1400, 2000], minutes: 120, verified: true },

  // number theory
  { id: 'cpa-euclid', tag: 'number theory', title: 'Euclidean algorithm for computing the greatest common divisor (cp-algorithms)', url: 'https://cp-algorithms.com/algebra/euclid-algorithm.html', kind: 'article', tier: [900, 1400], minutes: 15, verified: true },
  { id: 'cpa-sieve', tag: 'number theory', title: 'Sieve of Eratosthenes (cp-algorithms)', url: 'https://cp-algorithms.com/algebra/sieve-of-eratosthenes.html', kind: 'article', tier: [1000, 1600], minutes: 25, verified: true },
  { id: 'usaco-gold-divisibility', tag: 'number theory', title: 'Divisibility (USACO Guide)', url: 'https://usaco.guide/gold/divisibility', kind: 'guide', tier: [1200, 1800], minutes: 30, verified: true },
  { id: 'cpa-extended-euclid', tag: 'number theory', title: 'Extended Euclidean Algorithm (cp-algorithms)', url: 'https://cp-algorithms.com/algebra/extended-euclid-algorithm.html', kind: 'article', tier: [1500, 2100], minutes: 20, verified: true },
  { id: 'cpa-phi', tag: 'number theory', title: "Euler's totient function (cp-algorithms)", url: 'https://cp-algorithms.com/algebra/phi-function.html', kind: 'article', tier: [1600, 2200], minutes: 25, verified: true },

  // bitmasks
  { id: 'usaco-silver-intro-bitwise', tag: 'bitmasks', title: 'Intro to Bitwise Operators (USACO Guide)', url: 'https://usaco.guide/silver/intro-bitwise', kind: 'guide', tier: [1000, 1600], minutes: 30, verified: true },
  { id: 'cses-bitwise', tag: 'bitmasks', title: 'CSES Problem Set: Bitwise Operations section', url: 'https://cses.fi/problemset/task/1146', kind: 'problems', tier: [1300, 2100], minutes: 120, verified: true },
  { id: 'cpa-all-submasks', tag: 'bitmasks', title: 'Enumerating submasks of a bitmask (cp-algorithms)', url: 'https://cp-algorithms.com/algebra/all-submasks.html', kind: 'article', tier: [1600, 2200], minutes: 15, verified: true },
  { id: 'usaco-gold-dp-bitmasks', tag: 'bitmasks', title: 'Bitmask DP (USACO Guide)', url: 'https://usaco.guide/gold/dp-bitmasks', kind: 'guide', tier: [1700, 2300], minutes: 40, verified: true },

  // dp
  { id: 'usaco-gold-intro-dp', tag: 'dp', title: 'Introduction to DP (USACO Guide)', url: 'https://usaco.guide/gold/intro-dp', kind: 'guide', tier: [1100, 1700], minutes: 40, verified: true },
  { id: 'usaco-gold-knapsack', tag: 'dp', title: 'Knapsack DP (USACO Guide)', url: 'https://usaco.guide/gold/knapsack', kind: 'guide', tier: [1300, 1900], minutes: 40, verified: true },
  { id: 'usaco-gold-paths-grids', tag: 'dp', title: 'Paths on Grids (USACO Guide)', url: 'https://usaco.guide/gold/paths-grids', kind: 'guide', tier: [1300, 1800], minutes: 30, verified: true },
  { id: 'cses-dp', tag: 'dp', title: 'CSES Problem Set: Dynamic Programming section', url: 'https://cses.fi/problemset/task/1633', kind: 'problems', tier: [1300, 2000], minutes: 240, verified: true },
  { id: 'atcoder-dp-contest', tag: 'dp', title: 'Educational DP Contest (AtCoder)', url: 'https://atcoder.jp/contests/dp', kind: 'problems', tier: [1400, 2400], minutes: 300, verified: true },

  // data structures
  { id: 'usaco-silver-prefix-sums', tag: 'data structures', title: 'Introduction to Prefix Sums (USACO Guide)', url: 'https://usaco.guide/silver/prefix-sums', kind: 'guide', tier: [1000, 1500], minutes: 25, verified: true },
  { id: 'usaco-gold-purs', tag: 'data structures', title: 'Point Update Range Sum (USACO Guide)', url: 'https://usaco.guide/gold/PURS', kind: 'guide', tier: [1500, 2000], minutes: 40, verified: true },
  { id: 'cpa-fenwick', tag: 'data structures', title: 'Fenwick Tree (cp-algorithms)', url: 'https://cp-algorithms.com/data_structures/fenwick.html', kind: 'article', tier: [1600, 2100], minutes: 35, verified: true },
  { id: 'cpa-segment-tree', tag: 'data structures', title: 'Segment Tree (cp-algorithms)', url: 'https://cp-algorithms.com/data_structures/segment_tree.html', kind: 'article', tier: [1700, 2400], minutes: 60, verified: true },
  { id: 'cfedu-segment-tree', tag: 'data structures', title: 'ITMO Academy: pilot course, Segment Tree part 1 (Codeforces EDU)', url: 'https://codeforces.com/edu/course/2/lesson/4', kind: 'course', tier: [1600, 2300], minutes: 240, verified: false },

  // graphs
  { id: 'usaco-bronze-intro-graphs', tag: 'graphs', title: 'Introduction to Graphs (USACO Guide)', url: 'https://usaco.guide/bronze/intro-graphs', kind: 'guide', tier: [900, 1300], minutes: 20, verified: true },
  { id: 'usaco-silver-graph-traversal', tag: 'graphs', title: 'Graph Traversal (USACO Guide)', url: 'https://usaco.guide/silver/graph-traversal', kind: 'guide', tier: [1100, 1600], minutes: 40, verified: true },
  { id: 'cpa-bfs', tag: 'graphs', title: 'Breadth First Search (cp-algorithms)', url: 'https://cp-algorithms.com/graph/breadth-first-search.html', kind: 'article', tier: [1200, 1700], minutes: 20, verified: true },
  { id: 'usaco-gold-toposort', tag: 'graphs', title: 'Topological Sort (USACO Guide)', url: 'https://usaco.guide/gold/toposort', kind: 'guide', tier: [1400, 1900], minutes: 30, verified: true },
  { id: 'cses-graphs', tag: 'graphs', title: 'CSES Problem Set: Graph Algorithms section', url: 'https://cses.fi/problemset/task/1192', kind: 'problems', tier: [1300, 2200], minutes: 240, verified: true },

  // dfs and similar
  { id: 'cpa-dfs', tag: 'dfs and similar', title: 'Depth First Search (cp-algorithms)', url: 'https://cp-algorithms.com/graph/depth-first-search.html', kind: 'article', tier: [1100, 1600], minutes: 20, verified: true },
  { id: 'usaco-silver-flood-fill', tag: 'dfs and similar', title: 'Flood Fill (USACO Guide)', url: 'https://usaco.guide/silver/flood-fill', kind: 'guide', tier: [1100, 1600], minutes: 30, verified: true },
  { id: 'usaco-silver-func-graphs', tag: 'dfs and similar', title: 'Introduction to Functional Graphs (USACO Guide)', url: 'https://usaco.guide/silver/func-graphs', kind: 'guide', tier: [1400, 1900], minutes: 30, verified: true },
  { id: 'cpa-topological-sort', tag: 'dfs and similar', title: 'Topological Sorting (cp-algorithms)', url: 'https://cp-algorithms.com/graph/topological-sort.html', kind: 'article', tier: [1400, 1900], minutes: 15, verified: true },

  // trees
  { id: 'usaco-silver-intro-tree', tag: 'trees', title: 'Introduction to Tree Algorithms (USACO Guide)', url: 'https://usaco.guide/silver/intro-tree', kind: 'guide', tier: [1200, 1700], minutes: 30, verified: true },
  { id: 'cses-trees', tag: 'trees', title: 'CSES Problem Set: Tree Algorithms section', url: 'https://cses.fi/problemset/task/1674', kind: 'problems', tier: [1400, 2200], minutes: 180, verified: true },
  { id: 'usaco-gold-dp-trees', tag: 'trees', title: 'DP on Trees - Introduction (USACO Guide)', url: 'https://usaco.guide/gold/dp-trees', kind: 'guide', tier: [1600, 2100], minutes: 40, verified: true },
  { id: 'usaco-gold-tree-euler', tag: 'trees', title: '(Optional) Euler Tour Technique (USACO Guide)', url: 'https://usaco.guide/gold/tree-euler', kind: 'guide', tier: [1700, 2200], minutes: 30, verified: true },
  { id: 'cpa-lca-binary-lifting', tag: 'trees', title: 'Lowest Common Ancestor - Binary Lifting (cp-algorithms)', url: 'https://cp-algorithms.com/graph/lca_binary_lifting.html', kind: 'article', tier: [1700, 2300], minutes: 25, verified: true },

  // combinatorics
  { id: 'usaco-gold-combo', tag: 'combinatorics', title: 'Combinatorics (USACO Guide)', url: 'https://usaco.guide/gold/combo', kind: 'guide', tier: [1300, 1900], minutes: 40, verified: true },
  { id: 'cpa-binomial', tag: 'combinatorics', title: 'Binomial Coefficients (cp-algorithms)', url: 'https://cp-algorithms.com/combinatorics/binomial-coefficients.html', kind: 'article', tier: [1400, 2000], minutes: 30, verified: true },
  { id: 'cpa-inclusion-exclusion', tag: 'combinatorics', title: 'The Inclusion-Exclusion Principle (cp-algorithms)', url: 'https://cp-algorithms.com/combinatorics/inclusion-exclusion.html', kind: 'article', tier: [1800, 2400], minutes: 45, verified: true },
  { id: 'cses-counting', tag: 'combinatorics', title: 'CSES Problem Set: Counting Problems section', url: 'https://cses.fi/problemset/task/3413', kind: 'problems', tier: [1800, 2500], minutes: 180, verified: true },

  // dsu
  { id: 'usaco-gold-dsu', tag: 'dsu', title: 'Disjoint Set Union (USACO Guide)', url: 'https://usaco.guide/gold/dsu', kind: 'guide', tier: [1400, 1900], minutes: 30, verified: true },
  { id: 'cpa-dsu', tag: 'dsu', title: 'Disjoint Set Union (cp-algorithms)', url: 'https://cp-algorithms.com/data_structures/disjoint_set_union.html', kind: 'article', tier: [1500, 2200], minutes: 45, verified: true },
  { id: 'cfedu-dsu', tag: 'dsu', title: 'ITMO Academy: pilot course, Disjoint Sets Union (Codeforces EDU)', url: 'https://codeforces.com/edu/course/2/lesson/7', kind: 'course', tier: [1500, 2200], minutes: 180, verified: false },

  // shortest paths
  { id: 'usaco-gold-unweighted-shortest-paths', tag: 'shortest paths', title: 'Shortest Paths with Unweighted Edges (USACO Guide)', url: 'https://usaco.guide/gold/unweighted-shortest-paths', kind: 'guide', tier: [1300, 1800], minutes: 30, verified: true },
  { id: 'usaco-gold-shortest-paths', tag: 'shortest paths', title: 'Shortest Paths with Non-Negative Edge Weights (USACO Guide)', url: 'https://usaco.guide/gold/shortest-paths', kind: 'guide', tier: [1500, 2000], minutes: 40, verified: true },
  { id: 'cpa-dijkstra-sparse', tag: 'shortest paths', title: 'Dijkstra on sparse graphs (cp-algorithms)', url: 'https://cp-algorithms.com/graph/dijkstra_sparse.html', kind: 'article', tier: [1500, 2000], minutes: 20, verified: true },
  { id: 'cpa-01-bfs', tag: 'shortest paths', title: '0-1 BFS (cp-algorithms)', url: 'https://cp-algorithms.com/graph/01_bfs.html', kind: 'article', tier: [1600, 2100], minutes: 15, verified: true },
  { id: 'cpa-floyd-warshall', tag: 'shortest paths', title: 'Floyd-Warshall - finding all shortest paths (cp-algorithms)', url: 'https://cp-algorithms.com/graph/all-pair-shortest-path-floyd-warshall.html', kind: 'article', tier: [1600, 2100], minutes: 20, verified: true },

  // games
  { id: 'usaco-adv-game-theory', tag: 'games', title: 'Game Theory (USACO Guide)', url: 'https://usaco.guide/adv/game-theory', kind: 'guide', tier: [1400, 2100], minutes: 40, verified: true },
  { id: 'cpa-sprague-grundy', tag: 'games', title: 'Sprague-Grundy theorem. Nim (cp-algorithms)', url: 'https://cp-algorithms.com/game_theory/sprague-grundy-nim.html', kind: 'article', tier: [1800, 2400], minutes: 40, verified: true },
  { id: 'cpa-games-on-graphs', tag: 'games', title: 'Games on arbitrary graphs (cp-algorithms)', url: 'https://cp-algorithms.com/game_theory/games_on_graphs.html', kind: 'article', tier: [2000, 2600], minutes: 25, verified: true },

  // interactive
  { id: 'cses-interactive', tag: 'interactive', title: 'CSES Problem Set: Interactive Problems section', url: 'https://cses.fi/problemset/task/3112', kind: 'problems', tier: [1300, 2100], minutes: 120, verified: true },
  { id: 'usaco-adv-interactive', tag: 'interactive', title: 'Interactive and Communication Problems (USACO Guide)', url: 'https://usaco.guide/adv/interactive', kind: 'guide', tier: [1600, 2400], minutes: 30, verified: true },

  // hashing
  { id: 'usaco-gold-hashmaps', tag: 'hashing', title: '(Optional) Hashmaps (USACO Guide)', url: 'https://usaco.guide/gold/hashmaps', kind: 'guide', tier: [1300, 1900], minutes: 25, verified: true },
  { id: 'cpa-string-hashing', tag: 'hashing', title: 'String Hashing (cp-algorithms)', url: 'https://cp-algorithms.com/string/string-hashing.html', kind: 'article', tier: [1500, 2100], minutes: 30, verified: true },
  { id: 'usaco-gold-hashing', tag: 'hashing', title: 'Hashing (USACO Guide)', url: 'https://usaco.guide/gold/hashing', kind: 'guide', tier: [1600, 2200], minutes: 40, verified: true },

  // probabilities
  { id: 'cses-book-probability', tag: 'probabilities', title: "Competitive Programmer's Handbook, ch. 24 Probability (PDF)", url: 'https://cses.fi/book/book.pdf', kind: 'guide', tier: [1500, 2100], minutes: 40, verified: true },
  { id: 'cses-dice-probability', tag: 'probabilities', title: 'Dice Probability (CSES, Mathematics section)', url: 'https://cses.fi/problemset/task/1725', kind: 'problems', tier: [1600, 2100], minutes: 45, verified: true },
  { id: 'usaco-adv-random', tag: 'probabilities', title: 'Randomness (USACO Guide)', url: 'https://usaco.guide/adv/random', kind: 'guide', tier: [1900, 2600], minutes: 40, verified: true },

  // divide and conquer
  { id: 'usaco-plat-dc-srq', tag: 'divide and conquer', title: 'Divide & Conquer - SRQ (USACO Guide)', url: 'https://usaco.guide/plat/DC-SRQ', kind: 'guide', tier: [1900, 2500], minutes: 40, verified: true },
  { id: 'cpa-dc-dp', tag: 'divide and conquer', title: 'Divide and Conquer DP (cp-algorithms)', url: 'https://cp-algorithms.com/dynamic_programming/divide-and-conquer-dp.html', kind: 'article', tier: [2100, 2700], minutes: 30, verified: true },
  { id: 'usaco-plat-dc-dp', tag: 'divide and conquer', title: 'Divide & Conquer - DP (USACO Guide)', url: 'https://usaco.guide/plat/DC-DP', kind: 'guide', tier: [2100, 2700], minutes: 40, verified: true },

  // geometry
  { id: 'usaco-bronze-rect-geo', tag: 'geometry', title: 'Rectangle Geometry (USACO Guide)', url: 'https://usaco.guide/bronze/rect-geo', kind: 'guide', tier: [800, 1400], minutes: 20, verified: true },
  { id: 'cpa-oriented-area', tag: 'geometry', title: 'Oriented area of a triangle (cp-algorithms)', url: 'https://cp-algorithms.com/geometry/oriented-triangle-area.html', kind: 'article', tier: [1500, 2000], minutes: 15, verified: true },
  { id: 'usaco-plat-geo-pri', tag: 'geometry', title: 'Geometry Primitives (USACO Guide)', url: 'https://usaco.guide/plat/geo-pri', kind: 'guide', tier: [1700, 2300], minutes: 45, verified: true },
  { id: 'cpa-convex-hull', tag: 'geometry', title: 'Convex hull construction (cp-algorithms)', url: 'https://cp-algorithms.com/geometry/convex-hull.html', kind: 'article', tier: [1900, 2400], minutes: 30, verified: true },
  { id: 'cses-geometry', tag: 'geometry', title: 'CSES Problem Set: Geometry section', url: 'https://cses.fi/problemset/task/2189', kind: 'problems', tier: [1700, 2400], minutes: 180, verified: true },
]

export const RES_BY_ID = new Map(RESOURCES.map(r => [r.id, r]))
export const resourcesFor = (tag: string) => RESOURCES.filter(r => r.tag === tag)
