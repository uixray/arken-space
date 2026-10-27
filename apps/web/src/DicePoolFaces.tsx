import type { DiceResult } from "@arken/contracts";

export function DicePoolFaces({
  dice,
}: {
  dice: Pick<DiceResult, "rollMode" | "poolTerms" | "selectedPool">;
}) {
  if (
    !dice.poolTerms ||
    (dice.rollMode !== "ADVANTAGE" && dice.rollMode !== "DISADVANTAGE")
  )
    return null;

  const selectedPool = dice.selectedPool ?? 0;
  return (
    <div
      className="dice-pool-faces"
      role="group"
      aria-label="Значения кубиков в обоих пулах"
    >
      {dice.poolTerms.map((terms, poolIndex) => {
        const selected = poolIndex === selectedPool;
        return (
          <div
            className={`dice-pool-faces__pool${selected ? " is-selected" : " is-discarded"}`}
            key={poolIndex}
          >
            <strong>
              Пул {poolIndex + 1} · {selected ? "выбран" : "не выбран"}
            </strong>
            <span className="dice-pool-faces__terms">
              {terms.map((term, termIndex) => (
                <span className="dice-pool-faces__term" key={termIndex}>
                  <small>{term.notation}</small>
                  {term.rolls.map((roll, rollIndex) => (
                    <span
                      className="dice-pool-faces__face"
                      key={`${termIndex}-${rollIndex}`}
                    >
                      {roll}
                    </span>
                  ))}
                </span>
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
