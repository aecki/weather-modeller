import React, { useEffect, useId, useRef, useState } from 'react';
import { Mercator } from '@visx/geo';

const color = (value) =>
  !Number.isFinite(value)
    ? '#eef1ed'
    : value < 20
      ? '#bccfce'
      : value < 50
        ? '#6da9a2'
        : value < 100
          ? '#e5b36d'
          : value < 150
            ? '#d87a43'
            : '#a63c2e';
import { mapTiles, distanceScale } from './map-tiles.mjs';
import { layout, pan, zoomAt, wheelZoomEnabled, MAP_BOUNDS } from './map-viewport.mjs';
export function StationMap({
  width: measuredWidth,
  height: measuredHeight = 560,
  stations,
  selected,
  onSelect,
  resetCount,
}) {
  const bounds = MAP_BOUNDS;
  const container = useRef(null);
  const [fullscreenSize, setFullscreenSize] = useState(null);
  const width = fullscreenSize?.width || measuredWidth;
  const height = fullscreenSize?.height || measuredHeight;
  useEffect(() => {
    const update = () =>
      setFullscreenSize(
        document.fullscreenElement === container.current
          ? { width: window.innerWidth, height: window.innerHeight }
          : null,
      );
    document.addEventListener('fullscreenchange', update);
    window.addEventListener('resize', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  const [exploring, setExploring] = useState(false);
  const interactive = exploring || Boolean(fullscreenSize);
  const [tileRetry, setTileRetry] = useState(0);
  const [tileFailed, setTileFailed] = useState(false);
  const [showStations, setShowStations] = useState(true);
  const maxZoom = 256;
  const [view, setView] = useState({ zoom: 1 });
  const currentView = useRef(view);
  const svg = useRef(null);
  const pointers = useRef(new Map());
  const dragged = useRef(false);
  const down = useRef(null);
  const [hover, setHover] = useState(null);
  const clip = useId().replaceAll(':', '');
  const commit = (next) => {
    currentView.current = next;
    setView(next);
  };
  const reset = () => commit({ zoom: 1 });
  useEffect(() => {
    currentView.current = { zoom: 1 };
    setView({ zoom: 1 });
  }, [resetCount]);
  const camera = layout(bounds, width, height, view, maxZoom);
  const localPoint = (event) => {
    const rect = svg.current.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) * width) / rect.width,
      ((event.clientY - rect.top) * height) / rect.height,
    ];
  };
  useEffect(() => {
    const element = svg.current;
    const wheel = (event) => {
      if (!wheelZoomEnabled(event, Boolean(fullscreenSize))) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const point = [
        ((event.clientX - rect.left) * width) / rect.width,
        ((event.clientY - rect.top) * height) / rect.height,
      ];
      const delta =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
      const next = zoomAt(
        bounds,
        width,
        height,
        currentView.current,
        Math.exp(-Math.max(-120, Math.min(120, delta)) * 0.003),
        point,
        maxZoom,
      );
      currentView.current = next;
      setView(next);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [width, height, maxZoom, fullscreenSize]);
  const start = (event) => {
    if (event.pointerType === 'touch' && !interactive) {
      dragged.current = false;
      return;
    }
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (pointers.current.size === 0) {
      dragged.current = false;
      down.current = localPoint(event);
    }
    pointers.current.set(event.pointerId, localPoint(event));
    // Capture on the hit target, preserving a click on a station after a tap.
    event.target.setPointerCapture(event.pointerId);
  };
  const move = (event) => {
    if (!pointers.current.has(event.pointerId)) return;
    const previous = [...pointers.current.values()];
    const point = localPoint(event);
    pointers.current.set(event.pointerId, point);
    const next = [...pointers.current.values()];
    if (down.current && Math.hypot(point[0] - down.current[0], point[1] - down.current[1]) > 4)
      dragged.current = true;
    const midpoint = (points) =>
      points.length > 1
        ? [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2]
        : points[0];
    const a = midpoint(previous),
      b = midpoint(next);
    let result = currentView.current;
    if (previous.length === 2) {
      dragged.current = true;
      const distance = (points) =>
        Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]);
      if (distance(previous) > 0)
        result = zoomAt(
          bounds,
          width,
          height,
          result,
          distance(next) / distance(previous),
          a,
          maxZoom,
        );
    }
    commit(pan(bounds, width, height, result, b[0] - a[0], b[1] - a[1], maxZoom));
  };
  const end = (event) => {
    pointers.current.delete(event.pointerId);
    if (!pointers.current.size) down.current = null;
  };
  const key = (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target !== event.currentTarget) return;
    const delta = {
      ArrowLeft: [60, 0],
      ArrowRight: [-60, 0],
      ArrowUp: [0, 60],
      ArrowDown: [0, -60],
    }[event.key];
    if (delta) {
      event.preventDefault();
      commit(pan(bounds, width, height, currentView.current, ...delta, maxZoom));
    } else if (['+', '=', '-'].includes(event.key)) {
      event.preventDefault();
      commit(
        zoomAt(
          bounds,
          width,
          height,
          currentView.current,
          event.key === '-' ? 1 / 1.4 : 1.4,
          undefined,
          maxZoom,
        ),
      );
    } else if (event.key === 'Home') {
      event.preventDefault();
      reset();
    }
  };
  const active = stations.find((station) => station.id === (hover || selected));
  return (
    <div className="visx-map" ref={container}>
      <svg
        ref={svg}
        width="100%"
        style={{ touchAction: interactive ? 'none' : 'pan-y' }}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        tabIndex={0}
        aria-label="Swiss rainfall station map. Drag to pan. Ctrl or Command plus scroll zooms; ordinary scrolling moves the page. Arrow keys pan; plus and minus zoom; Home resets."
        data-renderer="visx"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onKeyDown={key}
        onDoubleClick={(event) => {
          event.preventDefault();
          commit(
            zoomAt(bounds, width, height, currentView.current, 1.6, localPoint(event), maxZoom),
          );
        }}
      >
        <defs>
          <clipPath id={clip}>
            <rect width={width} height={height} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clip})`}>
          <Mercator data={[]} center={[0, 0]} scale={camera.scale} translate={camera.translate}>
            {({ projection }) => (
              <>
                {mapTiles(camera, width, height).map((tile) => (
                  <image
                    key={tile.url + tileRetry}
                    href={tile.url}
                    x={tile.x}
                    y={tile.y}
                    width={tile.size + 0.15}
                    height={tile.size + 0.15}
                    pointerEvents="none"
                    onError={() => setTileFailed(true)}
                  />
                ))}
                {showStations &&
                  stations.map((station) => {
                    const point = projection([station.lon, station.lat]);
                    const isSelected = station.id === selected;
                    return (
                      <circle
                        key={station.id}
                        cx={point[0]}
                        cy={point[1]}
                        r={isSelected ? 11 : Math.min(10, 5 + Math.sqrt(station.value || 0) / 3)}
                        fill={color(station.value)}
                        stroke={isSelected ? '#173b3e' : '#fff'}
                        strokeWidth={isSelected ? 3 : 1.5}
                        tabIndex={0}
                        role="button"
                        aria-label={`${station.name}: ${Number.isFinite(station.value) ? station.value.toFixed(1) + ' mm' : 'missing rainfall'}`}
                        onClick={() => {
                          if (!dragged.current) onSelect(station.id);
                        }}
                        onMouseEnter={() => setHover(station.id)}
                        onMouseLeave={() => setHover(null)}
                        onFocus={() => setHover(station.id)}
                        onBlur={() => setHover(null)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onSelect(station.id);
                          }
                        }}
                        className="visx-point"
                      >
                        <title>{station.name}</title>
                      </circle>
                    );
                  })}
                {showStations &&
                  active &&
                  (() => {
                    const point = projection([active.lon, active.lat]);
                    const x = Math.max(65, Math.min(width - 65, point[0]));
                    const y = Math.max(30, point[1] - 22);
                    if (point[0] < 0 || point[0] > width || point[1] < 0 || point[1] > height)
                      return null;
                    return (
                      <g pointerEvents="none">
                        <rect x={x - 62} y={y - 17} width={124} height={24} rx={4} fill="#173b3e" />
                        <text x={x} y={y - 2} textAnchor="middle" fill="#fff" fontSize={10}>
                          {active.id} ·{' '}
                          {Number.isFinite(active.value)
                            ? active.value.toFixed(1) + ' mm'
                            : 'Missing'}
                        </text>
                      </g>
                    );
                  })()}
              </>
            )}
          </Mercator>
        </g>
      </svg>
      <div className="map-controls" role="group" aria-label="Map navigation">
        <button
          aria-label="Zoom in"
          disabled={camera.zoom >= maxZoom}
          onClick={() =>
            commit(zoomAt(bounds, width, height, currentView.current, 1.4, undefined, maxZoom))
          }
        >
          +
        </button>
        <button
          aria-label="Zoom out"
          disabled={camera.zoom <= 1}
          onClick={() =>
            commit(zoomAt(bounds, width, height, currentView.current, 1 / 1.4, undefined, maxZoom))
          }
        >
          −
        </button>
        <button aria-label="Reset map view" onClick={reset}>
          ⌂
        </button>
      </div>
      <div className="map-options">
        <button aria-pressed={exploring} onClick={() => setExploring(!exploring)}>
          {exploring ? 'Finish exploring' : 'Explore map'}
        </button>
        <label>
          <input
            type="checkbox"
            checked={showStations}
            onChange={(e) => setShowStations(e.target.checked)}
          />{' '}
          Stations
        </label>
        {tileFailed && (
          <button
            onClick={() => {
              setTileFailed(false);
              setTileRetry(tileRetry + 1);
            }}
          >
            Retry map
          </button>
        )}
        <button
          onClick={() => {
            if (document.fullscreenElement) document.exitFullscreen();
            else container.current.requestFullscreen?.().catch(() => {});
          }}
        >
          {fullscreenSize ? 'Exit fullscreen' : 'Fullscreen'}
        </button>
      </div>
      <div className="map-distance" style={{ width: distanceScale(camera).pixels }}>
        {distanceScale(camera).label}
      </div>
      <span className="map-hint">
        {tileFailed ? 'Some swisstopo tiles unavailable · Retry map' : 'swisstopo · online map'}
        <br />
        {fullscreenSize
          ? 'Drag / pinch / scroll to explore'
          : 'Scroll page normally · Ctrl/⌘ + scroll to zoom'}
        <br />
        {exploring
          ? 'Touch exploration enabled · finish to scroll over the map'
          : 'Touch: choose Explore map to drag and pinch'}
      </span>
      <span className="map-credit">
        <a
          href="https://www.swisstopo.admin.ch/en/conditions-geodata"
          target="_blank"
          rel="noreferrer"
        >
          © swisstopo
        </a>
        {' · '}
        {
          <>
            <a
              href="https://docs.geo.admin.ch/visualize-data/xyz.html"
              target="_blank"
              rel="noreferrer"
            >
              Online map source
            </a>
          </>
        }
      </span>
    </div>
  );
}
