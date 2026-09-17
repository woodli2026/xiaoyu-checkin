// cloudfunctions/lib/level.js —— 星级评定（纯函数）
// ≥25→5, ≥18→4, ≥10→3, ≥4→2, 否则 1
function levelOf(streak) {
  const n = Number(streak) || 0;
  if (n >= 25) return 5;
  if (n >= 18) return 4;
  if (n >= 10) return 3;
  if (n >= 4) return 2;
  return 1;
}

module.exports = { levelOf };
