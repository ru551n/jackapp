import { Link } from 'react-router'
import { Page } from './Page'
import s from './adult.module.css'

// Credits and licence notices required for what the app serves (docs/audio.md, "Credits and licences").
const ext = (href: string, text = href) => (
  <a href={href} target="_blank" rel="noreferrer">
    {text}
  </a>
)

/** `/vuxen/om`: credits for voices, curriculum data and third-party software. */
export function About() {
  return (
    <Page title="Om appen">
      <section className={`${s.card} ${s.stack}`} aria-labelledby="credits-h">
        <h2 id="credits-h">Tack och licenser</h2>
        <ul className={s.plain}>
          <li>
            Svensk röst: Alma av Daniel Nylander ({ext('https://huggingface.co/yeagersthlm/piper-voice-sv-alma')}),{' '}
            {ext('https://creativecommons.org/licenses/by/4.0/deed.sv', 'CC BY 4.0')}
          </li>
          <li>
            Engelsk röst: Cori, inläst av Bryce Beattie för {ext('https://librivox.org', 'LibriVox')}, allmän egendom
            (public domain)
          </li>
          <li>
            Kursplaner: {ext('https://www.skolverket.se', 'Skolverket')},{' '}
            {ext('https://creativecommons.org/publicdomain/zero/1.0/deed.sv', 'CC0 1.0')}
          </li>
          <li>
            Uppläsning i appen använder espeak-ng (GPL-3.0), onnxruntime-web (MIT) och piper-phonemize (MIT). Typsnitt:
            Atkinson Hyperlegible (SIL OFL 1.1).
          </li>
        </ul>
        <p>
          Fullständig lista, källkodslänkar och licenstexter:{' '}
          <a href="THIRD_PARTY_NOTICES.txt">tredjepartsmeddelanden</a> · <a href="licenses/GPL-3.0.txt">GPL-3.0</a> ·{' '}
          <a href="voices/NOTICE">röstmodeller</a>
        </p>
        <p>
          <Link to="/vuxen">Tillbaka till översikten</Link>
        </p>
      </section>
    </Page>
  )
}
