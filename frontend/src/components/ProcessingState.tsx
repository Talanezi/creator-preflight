import { useEffect, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";

const stages = [
  ["Inspecting media", "Reading streams, duration, and format metadata"],
  ["Checking video", "Reviewing black and static-frame intervals"],
  ["Checking audio", "Reviewing silence and decoded peak evidence"],
  ["Checking publishing package", "Validating title, description, and profile rules"],
] as const;

interface ProcessingStateProps {
  filename: string;
  onComplete: () => void;
}

export function ProcessingState({ filename, onComplete }: ProcessingStateProps) {
  const [activeStage, setActiveStage] = useState(0);

  useEffect(() => {
    let completionTimer: number | undefined;
    const timer = window.setInterval(() => {
      setActiveStage((current) => {
        if (current >= stages.length - 1) {
          window.clearInterval(timer);
          completionTimer = window.setTimeout(onComplete, 500);
          return current;
        }
        return current + 1;
      });
    }, 700);
    return () => {
      window.clearInterval(timer);
      if (completionTimer !== undefined) window.clearTimeout(completionTimer);
    };
  }, [onComplete]);

  return (
    <main className="processing page-frame" data-testid="processing-state">
      <section className="processing-card panel">
        <div className="processing-visual" aria-hidden="true">
          <div className="scan-line" />
          <LoaderCircle className="spinner" />
        </div>
        <p className="eyebrow">Local analysis</p>
        <h1>Running preflight checks</h1>
        <p className="processing-file" title={filename}>{filename}</p>
        <ol className="stage-list" aria-live="polite">
          {stages.map(([title, detail], index) => {
            const complete = index < activeStage;
            const active = index === activeStage;
            return (
              <li key={title} className={active ? "is-active" : complete ? "is-complete" : ""}>
                <span className="stage-status">
                  {complete ? <Check aria-hidden="true" /> : <span>{index + 1}</span>}
                </span>
                <div><strong>{title}</strong><small>{detail}</small></div>
                {active && <LoaderCircle className="stage-spinner" aria-label="In progress" />}
              </li>
            );
          })}
        </ol>
        <p className="processing-note">Stages are shown without an estimated percentage.</p>
      </section>
    </main>
  );
}
