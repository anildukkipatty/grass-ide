import { runProgress, showQR } from "./progress";

const steps = [
  { label: "Uploading code...", duration: 5000 },
  { label: "Starting sandbox...", duration: 6000 },
  { label: "Installing dependencies...", duration: 5000 },
  { label: "Setting up Claude...", duration: 6000 },
  { label: "Configuring environment...", duration: 4000 },
  { label: "Finalizing deployment...", duration: 4000 },
];

export async function sync() {
  await runProgress(steps);
  showQR("https://grass.dev/session/abc123");
}
