// Official XYZ tiles use Web Mercator: x runs east, y runs south from the northwest.
export function mapTiles(camera, width, height) {
  const z = Math.max(7, Math.min(18, Math.ceil(Math.log2((camera.scale * 2 * Math.PI) / 256))));
  const n = 2 ** z;
  const size = (camera.scale * 2 * Math.PI) / n;
  const ox = camera.translate[0] - Math.PI * camera.scale;
  const oy = camera.translate[1] - Math.PI * camera.scale;
  const tiles = [];
  for (
    let x = Math.max(0, Math.floor(-ox / size));
    x <= Math.min(n - 1, Math.floor((width - ox) / size));
    x++
  ) {
    for (
      let y = Math.max(0, Math.floor(-oy / size));
      y <= Math.min(n - 1, Math.floor((height - oy) / size));
      y++
    ) {
      tiles.push({
        x: ox + x * size,
        y: oy + y * size,
        size,
        url: `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/${z}/${x}/${y}.jpeg`,
      });
    }
  }
  return tiles;
}
export function distanceScale(camera) {
  const latitude = 2 * Math.atan(Math.exp(-camera.centre[1])) - Math.PI / 2;
  const metresPerPixel = (6378137 * Math.cos(latitude)) / camera.scale;
  const target = metresPerPixel * 100;
  const power = 10 ** Math.floor(Math.log10(target));
  const metres = [5, 2, 1].map((n) => n * power).find((n) => n <= target) || power;
  return {
    pixels: metres / metresPerPixel,
    label: metres >= 1000 ? `${metres / 1000} km` : `${metres} m`,
  };
}
