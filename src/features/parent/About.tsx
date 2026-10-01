import s from './parent.module.css'

/** Credits required by the voice licences (docs/audio.md). */
export function About() {
  return (
    <section className={s.card} aria-labelledby="about-h">
      <h2 id="about-h">Om appen</h2>
      <p>
        Uppläsningen görs med talsyntesen Piper, direkt på enheten. Svensk röst: Alma (CC BY 4.0), tränad på NST-data
        från Språkbanken. Engelsk röst: Cori (fri, LibriVox). Inga ljud eller data skickas någonstans.
      </p>
    </section>
  )
}
