const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateLicenseKey() {
  const segments = [];
  for (let s = 0; s < 4; s++) {
    let seg = "";
    for (let i = 0; i < 4; i++) {
      seg += CHARS[Math.floor(Math.random() * CHARS.length)];
    }
    segments.push(seg);
  }
  return segments.join("-");
}

module.exports = { generateLicenseKey };
