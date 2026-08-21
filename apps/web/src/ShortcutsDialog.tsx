import { ArkenDialog } from "./ui/ArkenDialog";
import {
  canvasSections,
  chatCommands,
  chatSection,
  guideSectionsForRole,
  type GuideSection,
} from "./landing-guide-content";

/**
 * UIX-462 — шпаргалка по клавишам внутри игры.
 *
 * Та же, что на странице входа, и из тех же данных: второй список разошёлся бы
 * с первым на первой же правке, а список, обещающий несуществующую клавишу,
 * хуже отсутствующего.
 *
 * Живёт рядом с выходом — в меню сеанса. Туда человек и лезет, когда ищет
 * «что-то про программу, а не про игру»; отдельная кнопка на панели карты
 * стоила бы места, которого там и так нет.
 */
function Keys({ keys }: { keys: readonly string[] }) {
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

export function ShortcutsDialog({
  open,
  isGm,
  onClose,
}: {
  open: boolean;
  isGm: boolean;
  onClose: () => void;
}) {
  // Мастерские строки игроку не показываются вовсе — вместе с пометкой «только
  // мастер», которая на странице входа объясняет, чего он не увидит в игре.
  const sections = guideSectionsForRole(canvasSections, isGm);
  return (
    <ArkenDialog
      open={open}
      onClose={onClose}
      title="Клавиши и команды"
      // Окно, а не модальное подтверждение: шпаргалку открывают, чтобы
      // подсмотреть клавишу и тут же ею воспользоваться, — карта должна
      // остаться на виду.
      variant="workspace"
      footer={false}
    >
      <div className="guide-shortcuts">
        <p className="guide-section__hint guide-shortcuts__preface">
          Клавиши на карте работают, когда карта в фокусе — щёлкните по ней один
          раз. Сочетания с Ctrl и Alt не перехватываются, так что привычные
          браузерные остаются на месте.
        </p>
        {sections.map((section) => (
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
    </ArkenDialog>
  );
}
