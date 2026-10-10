import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canvasSections,
  chatCommands,
  chatSection,
  guideFeatures,
  type GuideSection,
} from "./landing-guide-content";
import {
  guideAnchor,
  resolveGuideHash,
  searchGuide,
} from "./landing-guide-search";
import { guideFaq, guideWorkflows } from "./landing-guide-workflows";
import "./landing-guide.css";

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
    <section
      className="guide-section"
      id={guideAnchor(section.title)}
      tabIndex={-1}
    >
      <h3 className="guide-section__title">{section.title}</h3>
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

const guideScreenshots = [
  {
    src: "/assets/guide/desktop-guide-expanded.webp",
    width: 1120,
    height: 1214,
    alt: "Снимок раскрытого руководства со списком разделов и сочетаний клавиш",
    caption: "Все разделы",
  },
  {
    src: "/assets/guide/desktop-guide-search-d20.webp",
    width: 1120,
    height: 262,
    alt: "Снимок руководства с результатом поиска по команде /d20",
    caption: "Поиск /d20",
  },
  {
    src: "/assets/guide/mobile-guide-search-fog.webp",
    width: 358,
    height: 807,
    alt: "Снимок мобильного руководства с результатом поиска «туман» и пометками для мастера",
    caption: "Поиск «туман»",
  },
] as const;

export function LandingGuide() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focusSearchOnOpen, setFocusSearchOnOpen] = useState(false);
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sections = useMemo(
    () => [
      ...canvasSections,
      chatSection,
      {
        title: "Команды в чате",
        hint: "Начните сообщение со слэша — появится подсказка со списком.",
        shortcuts: chatCommands.map(({ command, description }) => ({
          keys: [command],
          action: description,
        })),
      },
    ],
    [],
  );
  const filteredSections = useMemo(
    () => searchGuide(sections, query),
    [sections, query],
  );

  useEffect(() => {
    if (open && focusSearchOnOpen) {
      searchRef.current?.focus();
      setFocusSearchOnOpen(false);
    }
  }, [focusSearchOnOpen, open]);

  useEffect(() => {
    if (!open || query || !pendingAnchor) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(pendingAnchor);
      // Instant navigation keeps TOC targets hit-test stable while browser
      // history restores scroll; an in-flight smooth scroll can put a sibling
      // link under the pointer before the next TOC click.
      target?.scrollIntoView?.({ block: "start", behavior: "auto" });
      target?.focus({ preventScroll: true });
      setPendingAnchor(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [open, pendingAnchor, query]);

  const reveal = useCallback(
    (hash = window.location.hash) => {
      const id = resolveGuideHash(hash, sections);
      if (!id) {
        setPendingAnchor(null);
        return;
      }
      setQuery("");
      setOpen(true);
      setPendingAnchor(id);
    },
    [sections],
  );

  useEffect(() => {
    if (window.location.hash.startsWith("#guide-")) reveal();
    const onHashChange = () => reveal();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [reveal]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.altKey || event.metaKey)
        return;
      const target = event.target as HTMLElement;
      if (
        target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
      )
        return;
      setOpen(true);
      setFocusSearchOnOpen(true);
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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

      <section
        className="guide-procedures"
        aria-labelledby="guide-procedures-title"
      >
        <h3 id="guide-procedures-title">Как сделать</h3>
        <div className="guide-procedures__grid">
          {guideWorkflows.map((workflow) => (
            <article className="guide-procedure" key={workflow.id}>
              <h4>{workflow.title}</h4>
              <p className="guide-procedure__roles">
                {workflow.roles.join(" · ")}
              </p>
              <p>
                <strong>Перед началом:</strong> {workflow.prerequisite}
              </p>
              <ol>
                {workflow.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p>
                <strong>Результат:</strong> {workflow.outcome}
              </p>
              <a href={workflow.helpHref}>Подсказка по клавишам и командам</a>
            </article>
          ))}
        </div>
      </section>

      <section className="guide-faq" aria-labelledby="guide-faq-title">
        <h3 id="guide-faq-title">Короткие ответы</h3>
        <dl>
          {guideFaq.map((item) => (
            <div className="guide-faq__item" key={item.id}>
              <dt>{item.question}</dt>
              <dd>
                {item.answer} <a href={item.helpHref}>К разделу шпаргалки</a>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <details className="guide-gallery">
        <summary>Снимки интерфейса</summary>
        <div className="guide-gallery__grid">
          {guideScreenshots.map((screenshot) => (
            <figure className="guide-gallery__item" key={screenshot.src}>
              <img
                src={screenshot.src}
                alt={screenshot.alt}
                width={screenshot.width}
                height={screenshot.height}
                loading="lazy"
                decoding="async"
                sizes="(max-width: 640px) calc(100vw - 2rem), (max-width: 1024px) 50vw, 32vw"
              />
              <figcaption>{screenshot.caption}</figcaption>
            </figure>
          ))}
        </div>
      </details>

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
          <nav className="guide-toc" aria-label="Разделы руководства">
            {sections.map((section) => (
              <a
                key={section.title}
                href={`#${guideAnchor(section.title)}`}
                onClick={(event) => {
                  event.preventDefault();
                  history.pushState(null, "", `#${guideAnchor(section.title)}`);
                  reveal(`#${guideAnchor(section.title)}`);
                }}
              >
                {section.title}
              </a>
            ))}
          </nav>
          <label className="guide-search-label" htmlFor="guide-search">
            Найти клавишу или действие
          </label>
          <div className="guide-search">
            <input
              ref={searchRef}
              id="guide-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Например: туман, /d20, отменить"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
              >
                Сбросить поиск
              </button>
            )}
          </div>
          <p className="guide-search-status" aria-live="polite">
            {query
              ? `Разделов найдено: ${filteredSections.length}`
              : "Поиск по разделам и действиям"}
          </p>
          {filteredSections.length ? (
            filteredSections.map((section) => (
              <Section section={section} key={section.title} />
            ))
          ) : (
            <p role="status">Ничего не найдено. Попробуйте другое слово.</p>
          )}
        </div>
      )}
    </section>
  );
}
