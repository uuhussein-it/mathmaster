/**
 * Phaser is large, so it is loaded only when the realm opens (once), from the
 * copy shipped in frontend/vendor (the page's security policy only runs
 * scripts from this site).
 */
const SRC = 'vendor/phaser-3.90.0.min.js';
let loading = null;

export function loadPhaser() {
  if (window.Phaser) return Promise.resolve(window.Phaser);
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.onload = () => resolve(window.Phaser);
    s.onerror = () => { loading = null; reject(new Error('The game engine couldn’t load. Check your connection and try again.')); };
    document.head.append(s);
  });
  return loading;
}

/** Add a canvas as a texture once per game. */
export function tex(scene, key, make) {
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, make());
  return key;
}

/**
 * Start a Phaser game in `parent` with one scene. Art is drawn at width x
 * height art pixels and shown `zoom` times larger, crisp (pixelArt), and the
 * canvas then scales to fit its box.
 */
export function startGame(Phaser, parent, scene, { width, height, zoom, background = '#0b0816', physics }) {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: width * zoom,
    height: height * zoom,
    backgroundColor: background,
    pixelArt: true,
    banner: false,
    audio: { noAudio: true },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
    scene,
    ...(physics ? { physics } : {}),
  });
}

/** Text that stays sharp under the camera zoom. */
export function label(scene, x, y, text, { size = 6, color = '#ffffff', stroke = '#1a1426', font = "'Press Start 2P', monospace", align = 'center' } = {}) {
  const t = scene.add.text(x, y, text, {
    fontFamily: font, fontSize: `${size}px`, color, stroke, strokeThickness: Math.max(1, size / 4), align, resolution: 8,
  });
  t.setOrigin(0.5, 0.5);
  return t;
}
