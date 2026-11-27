# Meridian

A browser-based sailing experience on a 3D model of the real Earth. Pick a real port, pick a ship, then follow a calculated sea route or sail freely.

Experience Design open brief project.

**Live demo:** https://nyxtaku.github.io/meridian/ (prototype 03)
Earlier versions: [prototype 02](https://nyxtaku.github.io/meridian/p02/)

## Prototype 03: real world

- Real terrain and coastlines streamed from Cesium ion (Cesium World Terrain + Bing aerial imagery), starting off Piraeus
- Stylized look: real elevation, flat-shaded; satellite colours snapped to a small palette (scrub, soil, limestone, white towns, terracotta roofs)
- Sea level calibrated from Cesium's sea surface (Cesium heights are ellipsoidal; around Piraeus the sea sits ~38 m above zero)
- Ocean extends ~40 km and curves with the Earth
- Land collision with a "land ahead" warning; floating origin re-centres the world every 3 km
- Time speed ×1 / ×5 / ×20 / ×50
- Latitude/longitude in the HUD
- Performance: coarser terrain detail, limited tile processing per frame, throttled terrain raycasts

## Prototype 02: ships

- Ship select screen with three ships, each with its own handling:

  | Ship | Length | Top speed | Character |
  |---|---|---|---|
  | Fishing boat | 8 m | 19 kn | quick, sharp turns, rides every wave |
  | Freighter | 39 m | 15 kn | steady, wider turns |
  | Container ship | 61 m | 13 kn | slow to speed up and to turn, very stable |

- Real 3D models for the ships, buoys and a lighthouse
- V-shaped wake from the bow plus a stern trail
- Camera adapts to the ship's size and stays clear of land
- About panel with model credits

## Prototype 01: sailing

- Ocean with layered Gerstner waves and a sea-state slider (calm to very rough)
- Ships float on the waves: pitch and roll from four hull sample points
- Five-step throttle, rudder that only steers with speed
- Chase camera (drag to look, scroll to zoom)
- Placeholder islands with collision

## Controls

| Key | Action |
|---|---|
| 1 / 2 / 3 | Pick a ship on the select screen |
| W / S | Throttle up / down |
| A / D | Rudder left / right |
| C | Reset camera |
| R | Reset ship |
| T | Time speed ×1 / ×5 / ×20 / ×50 |

On touch devices, on-screen buttons replace the keys.

## Run locally

No build step, but the models load over HTTP, so serve the folder rather than opening the file directly:

```
npx serve .
```

## Stack

- [three.js](https://threejs.org) (loaded from jsDelivr)

- [3DTilesRendererJS](https://github.com/NASA-AMMOS/3DTilesRendererJS) with Cesium ion (terrain + imagery)

Planned: World Port Index, searoute-ts.

## Credits

Terrain and imagery: Cesium World Terrain and Bing Maps aerial imagery via Cesium ion. Imagery © Microsoft.


3D models: "Full Low Poly Sea & Ships Pack" (https://skfb.ly/pIT9V) by Muyaya Concept is licensed under Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/). Exported per model from the original file and scaled in code.
