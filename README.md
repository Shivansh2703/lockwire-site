# lockwirerobotics.com

The Lockwire website. Static [Astro](https://astro.build) site with a three.js view of the drone
starter, deployed to GitHub Pages by `.github/workflows/pages.yml`.

```bash
npm ci && npm run dev      # local preview
npm run build              # static site in dist/
```

Every number on the page is read from `src/data/`, which is written by real runs:

- `demo.json`: `uv run --no-project --with lockwire==0.2.3 python scripts/site_data.py`
  (add `--check` to confirm it still matches a fresh run).
- `test_step.json`: a baseline check on public PX4 flight log
  `1b8e43d5-04d8-4130-8227-628898f319c5` (PX4 Flight Review, CC BY 4.0).

The drone model is from [lockwire](https://github.com/Shivansh2703/lockwire) (Apache-2.0).
