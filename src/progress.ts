import cliProgress from "cli-progress";
import qrcode from "qrcode-terminal";

interface Step {
  label: string;
  duration: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runProgress(steps: Step[]) {
  const bar = new cliProgress.SingleBar(
    {
      format: "{step} [{bar}] {percentage}%",
      hideCursor: true,
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
    },
    cliProgress.Presets.shades_classic
  );

  const totalDuration = steps.reduce((sum, s) => sum + s.duration, 0);
  let elapsed = 0;

  bar.start(totalDuration, 0, { step: steps[0].label });

  for (const step of steps) {
    bar.update(elapsed, { step: step.label });

    const tickInterval = 100;
    const ticks = step.duration / tickInterval;

    for (let i = 0; i < ticks; i++) {
      await sleep(tickInterval);
      elapsed += tickInterval;
      bar.update(elapsed, { step: step.label });
    }
  }

  bar.update(totalDuration, { step: "Done!" });
  bar.stop();
}

export function showQR(url: string) {
  console.log();
  console.log("  Your session is ready!");
  console.log();

  qrcode.generate(url, { small: true }, (code: string) => {
    console.log(code);
  });

  console.log("  Scan the QR code to open your session.");
  console.log();
}
