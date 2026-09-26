# Not So Long Ago

LGBTQ+ history, laid across your own life and the lives of the people you love.

Put in up to six people (you, a parent, a grandparent, a partner, a kid) with the year each was born and the state they grew up in. The page draws a lifeline for each of them above bars showing when US rules against LGBTQ+ people were in effect: when gay sex was a crime, when psychiatry called it an illness, when gay people were barred from federal jobs and the military, when same-sex couples couldn't marry. Then it tells you how old each of you was when each rule changed.

- **Lifelines.** Drag across the chart, or use the year slider, to see any year: who was how old, which rules still held (with a count of states for the state-by-state ones, and the status in each person's home state), and what happened that year.
- **How old were you?** The turning points in a table, one column per person, plus a sentence for each person about their own state.
- **Year by year.** About 150 events from 1924 to 2026, filterable by kind (law, organizing, health and HIV, trans lives, politics, culture, around the world), with each person's age at the top of every year. Events for each person's home state (when its sodomy law ended, when marriage came) are added automatically.
- **Share.** Copies a link with the people in it, so a family can open the same lifelines. Nothing is sent anywhere; the people are saved in the browser.

It's one file, `index.html`, with no build step.

## The data

The events and the per-state dates are plain text blocks near the bottom of `index.html`, one line each, so they're easy to correct:

- `#data-events`: `date | category | tone | title | blurb`. Dates are `YYYY-MM-DD`, `YYYY-MM` or `YYYY`. Tone is `+` for a step forward, `-` for a setback or a loss, `.` for a moment.
- `#data-states`: `code | name | decriminalized | how | marriage | how | earlier marriage windows | first civil union or partnership | note`.

The bars (the "lanes") are in the `LANES` list in the script, each with its start and end dates and a note shown under **About the bars**.

Every date was checked against public sources: Supreme Court opinions, statutes and federal agency notices, and the Wikipedia articles that cite them (*Sodomy laws in the United States*, *Same-sex marriage in the United States*, and the history timelines). A few older state repeal dates are known only to the year (New Hampshire 1975, West Virginia 1976, Indiana, Vermont and Wyoming 1977), and are shown that way. Recent entries are current to September 2026: the 2025 trans military ban (still in effect, apart from the plaintiffs a June 2026 appeals ruling protects), the passport policy the Supreme Court let take effect in November 2025, and the Court's refusal to hear Kim Davis's challenge to Obergefell. When something changes, add a line.
