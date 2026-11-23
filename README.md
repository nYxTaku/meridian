# Meridian

A browser-based sailing experience on a 3D model of the real Earth. Pick a real port, pick a ship, then follow a calculated sea route or sail freely.

Experience Design open brief project.

**Live demo:** https://nyxtaku.github.io/meridian/

## Prototype 01: sailing

- Ocean with layered Gerstner waves and a sea-state slider (calm to very rough)
- Boat that floats on the waves: pitch and roll from four hull sample points
- Five-step throttle, rudder that only steers with speed
- Chase camera (drag to look, scroll to zoom)
- Placeholder islands with collision, buoys, foam wake

### Controls

| Key | Action |
|---|---|
| W / S | Throttle up / down |
| A / D | Rudder left / right |
| C | Reset camera |
| R | Reset boat |

On touch devices, on-screen buttons replace the keys.

## Run locally

No build step. Open `index.html` through any local server, for example:

```
npx serve .
```

## Stack

- [three.js](https://threejs.org) (loaded from jsDelivr)

Planned: 3DTilesRendererJS + Cesium ion terrain, World Port Index, searoute-ts.
