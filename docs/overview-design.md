# Overview design

The online web app separates a public rainfall story from its research explorer. Overview is the default. Its hierarchy is: location and calendar, actual daily amount, historical unusualness, then a few contextual facts. Pro Mode keeps regional uncertainty controls and a separate station explorer. Technical provenance remains available under expandable details rather than dominating the primary reading path.

The design review looked at the current [Met Office weather page](https://weather.metoffice.gov.uk/forecast/gcpvj0u07), [Our World in Data precipitation chart](https://ourworldindata.org/grapher/average-precipitation-per-year) and [WeatherArchive date/location controls](https://weatherarchive.app/). The resulting design uses location-first controls, prominent measured quantities, clear time/source context and progressive detail. It does not copy those sites' weather datasets or forecast content.

`web/overview.css` owns the public interface's quiet green/cream palette, typography, whitespace, rounded search/result cards and mobile layout. The research tools retain a denser independent layout. No image-generation or decorative fake weather is used.

Data graphics use visx: a linearly scaled actual rainfall bar, a 100-mark historical-frequency comparison, category bars with sampling ranges, wet-day share and a same-region selected-day/record-day comparison. Every plot has textual context and an accessible label; colour is not the only carrier of meaning. Marks in the frequency chart represent rounded percentages, not invented individual observations. Rare fractions below one percent say “fewer than one”; absent bootstrap support does not become zero uncertainty. Regional-average facts remain explicitly separate from the containing-cell selected amount.

## Web app only

There is no offline/standalone mode, local export endpoint or runtime-mode configuration. CSV downloads happen entirely in the browser. Python/Conda, build/data preparation tools and a plain static preview server remain development tools, not a separate user-facing app.

## Unified explorer layout (4 November 2026)

Product name: **aeckis rainfall explorer**, with a repository-owned SVG raindrop favicon. The reference was the current [MeteoSwiss French homepage](https://www.meteosuisse.admin.ch/), reviewed in the browser: white masthead, horizontal navigation, restrained blue/grey surfaces, red selection indicators and large map-led sections. The explorer uses its own branding and assets, not the federal crest or an official-service identity.

Pro Mode intentionally has only two destinations: Address analysis and Stations & gauges. All station records, maps, models, comparisons, downloads and methods share the network workspace. Former sample-only station/model routes redirect to it. Station and gauge maps show selectable locations, not fabricated or unrequested rainfall values. The finder retains separate network histories behind grouped station-code locations. Secondary data definitions stay in inline disclosures rather than adding navigation links.
