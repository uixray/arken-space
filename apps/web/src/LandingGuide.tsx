import { useState } from "react";
import {
  canvasSections,
  chatCommands,
  chatSection,
  guideFeatures,
  type GuideSection,
} from "./landing-guide-content";

/**
 * UIX-415: what the app does and which keys do it, shown before login.
 *
 * Before this, a first-time player arrived at a login form and learned the
 * controls by being told them at the table. Everything here is checked against
 * the code by `landing-guide-content.test.ts` — see that file for why.
 *
 * Collapsed by default. The landing page's job is still to let people in; the
 * guide is for the person who wants it, and an expanded wall of keys above the
 * fold would push the form off the screen.
 */
function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="guide-keys">
      {keys.map((key, index) => (
        <span key={key}>
          {index > 0 && <span className="guide-keys__plus">+</span>}
          <kbd className="guide-key">{key}</kbd>
        </span>
      ))}
    </span>
  );
}

function Section({ section }: { section: GuideSection }) {
  return (
    <section className="guide-section">
      <h4 className="guide-section__title">{section.title}</h4>
      {section.hint && <p className="guide-section__hint">{section.hint}</p>}
      <dl className="guide-list">
        {section.shortcuts.map((shortcut) => (
          <div className="guide-row" key={shortcut.keys.join("+")}>
            <dt>
              <Keys keys={shortcut.keys} />
            </dt>
            <dd>
              {shortcut.action}
              {shortcut.gmOnly && (
                <span className="guide-badge">только мастер</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function LandingGuide() {
  const [open, setOpen] = useState(false);

  return (
    <section
      className="landing-section landing-guide"
      aria-labelledby="guide-title"
    >
      <p className="landing-kicker">Как играть</p>
      <h2 id="guide-title">Краткое руководство</h2>
      <p className="landing-note">
        Всё управление собрано здесь. Ничего не нужно запоминать заранее —
        страница останется доступной с главной.
      </p>

      <div className="guide-features">
        {guideFeatures.map((feature) => (
          <article className="guide-feature" key={feature.title}>
            <h3>{feature.title}</h3>
            <p>{feature.text}</p>
          </article>
        ))}
      </div>

      <button
        type="button"
        className="guide-toggle"
        aria-expanded={open}
        aria-controls="guide-shortcuts"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Свернуть управление" : "Показать все клавиши и команды"}
      </button>

      {open && (
        <div className="guide-shortcuts" id="guide-shortcuts">
          <p className="guide-section__hint guide-shortcuts__preface">
            Клавиши на карте работают, когда карта в фокусе — щёлкните по ней
            один раз. Сочетания с Ctrl и Alt не перехватываются, так что
            привычные браузерные остаются на месте.
          </p>
          {canvasSections.map((section) => (
            <Section section={section} key={section.title} />
          ))}
          <Section section={chatSection} />
          <section className="guide-section">
            <h4 className="guide-section__title">Команды в чате</h4>
            <p className="guide-section__hint">
              Начните сообщение со слэша — появится подсказка со списком.
            </p>
            <dl className="guide-list">
              {chatCommands.map((item) => (
                <div className="guide-row" key={item.command}>
                  <dt>
                    <code className="guide-command">{item.command}</code>
                  </dt>
                  <dd>{item.description}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      )}
    </section>
  );
}
