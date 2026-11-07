# Overview design

The online web app separates a public rainfall story from its research explorer. Overview is the default. Its hierarchy is: location and calendar, actual daily amount, historical unusualness, then a few contextual facts. Pro Mode keeps regional uncertainty controls and a separate station explorer. Technical provenance remains available under expandable details rather than dominating the primary reading path.

The design review looked at the current [Met Office weather page](https://weather.metoffice.gov.uk/forecast/gcpvj0u07), [Our World in Data precipitation chart](https://ourworldindata.org/grapher/average-precipitation-per-year) and [WeatherArchive date/location controls](https://weatherarchive.app/). The resulting design uses location-first controls, prominent measured quantities, clear time/source context and progressive detail. It does not copy those sites' weather datasets or forecast content.

`web/overview.css` owns the public interface's quiet green/cream palette, typography, whitespace, rounded search/result cards and mobile layout. The research tools retain a denser independent layout. No image-generation or decorative fake weather is used.

Data graphics use visx: a linearly scaled actual rainfall bar, a 100-mark historical-frequency comparison, category bars with sampling ranges, wet-day share and a same-region selected-day/record-day comparison. Every plot has textual context and an accessible label; colour is not the only carrier of meaning. Marks in the frequency chart represent rounded percentages, not invented individual observations. Rare fractions below one percent say “fewer than one”; absent bootstrap support does not become zero uncertainty. Regional-average facts remain explicitly separate from the containing-cell selected amount.

## Web app only

There is no offline/standalone mode, local export endpoint or runtime-mode configuration. CSV downloads happen entirely in the browser. Python/Conda, build/data preparation tools and a plain static preview server remain development tools, not a separate user-facing app.

## Unified explorer layout (4 November 2026)

Product name at that review: **aeckis rainfall explorer**, with a repository-owned SVG raindrop favicon. The reference was the current [MeteoSwiss French homepage](https://www.meteosuisse.admin.ch/), reviewed in the browser: white masthead, horizontal navigation, restrained blue/grey surfaces, red selection indicators and large map-led sections. The explorer uses its own branding and assets, not the federal crest or an official-service identity.

Pro Mode intentionally has only two destinations: Address analysis and Stations & gauges. All station records, maps, models, comparisons, downloads and methods share the network workspace. Former sample-only station/model routes redirect to it. Station and gauge maps show selectable locations, not fabricated or unrequested rainfall values. The finder retains separate network histories behind grouped station-code locations. Secondary data definitions stay in inline disclosures rather than adding navigation links.

## Approved Rainfall / Water levels layout (5 November 2026)

Current product title: **aecki's rainfall explorer**. Rainfall and Water levels are the two primary destinations; a compact Basic/Pro segmented navigation stays on the right, including on narrow screens. Rainfall Basic remains the default. The approved mockup informs typography, white surfaces, ink headings, blue selection indicators, restrained metric strips and readable visx graphics. It is not a source of measurements or geography; no generated mockup charts were added to the app. `layout.css` owns this shell and visual treatment, overriding the retained scientific-component styles. It is checksummed along with the entry scripts/styles to avoid mixing deployment versions.

Rainfall Basic provides the address/calendar, selected-day amount and historical comparison, annual totals and monthly context. Its three inline shortcuts are Selected day, This year and Rainfall history. Rainfall Pro selects Address or Station; every existing station record, map, five ranked extremes, GEV/Gumbel/GPD/SMEV, held-out comparison, diagnostic and CSV remains in the Station workspace. The regional address models keep their existing fixed-area data and uncertainty interpretation.

Water Basic contains the 25 lake summaries and eligible recovery outlooks. Water Pro has Records, Recovery model and Validation. Records retains all FOEN gauge metadata, native measurement selection, map, daily query, date range, CSV and source timestamps. Recovery model preserves the measured seasonal chart, current forecast bands, historical analogue, earlier short-term benchmark and provenance. Validation reads the immutable low-water reference independently of the freshness/availability of current outlooks. It retains the weak-skill and sparse-archive caveats. No recovery forecasts are invented for unsupported lakes.

`routes.mjs` separates section, mode, source and water panel. Legacy station/model links remain valid. `app.js` lazy-mounts persistent roots for address analysis, precipitation stations and water; switching section/mode hides rather than destroys analytical state. Section links follow the active mode, and the mode switch remembers the last Pro view in each section. Basic/Pro labels do not change the scientific meaning of observations and models. Addresses are still not persisted to browser storage.

On phones the primary sections and mode switch stay on one row; address/date controls stack when necessary. Tables scroll within their own container. Keyboard focus, visible selected states, chart labels, skip navigation and source details remain available. No data preparation, fitting algorithm, spatial footprint, observation window or forecast pipeline changes are part of this layout update.

## Vercel-inspired visual system (7 November 2026)

The interface now takes visual cues from [Vercel Geist](https://vercel.com/geist/introduction): restrained surfaces, clear hierarchy, fine borders, compact navigation and consistent controls. It retains the explorer's blue identity and distinct scientific series colours. `layout.css` owns shared surface/spacing tokens and component treatments. The page uses a pale background with separate white analytical panels instead of one enclosing white card. Navigation remains Rainfall / Water levels with Basic / Pro on the right. Geist Sans and Geist Mono are bundled locally with their SIL Open Font License and pinned source hashes under `web/fonts/`. No hosted framework, font CDN, runtime service or data dependency was introduced.

`InteractiveChart.jsx` wraps the existing visx plots. Annual and monthly comparisons, rainfall frequency bands, return levels, diagnostics, four-model comparisons, held-out history, daily observations, measured lake/gauge levels and recovery trajectories support pointer inspection, click/tap pinning and keyboard arrows/Home/End/Escape. Inspectors use the supplied plotted records and preserve missing values, infinite bounds, observation/model distinctions and interval labels. They do not interpolate new observations or alter model inputs. Ordinary vertical touch scrolling stays available. Existing plot click-selection callbacks remain intact.

Forecast freshness safeguards remain unchanged. A locally cached recovery outlook can be withheld as stale; the redesign never relabels it as a current forecast. All original source, uncertainty and methodology content remains available.
