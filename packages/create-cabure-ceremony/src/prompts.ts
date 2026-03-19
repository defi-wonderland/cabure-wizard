import { createInterface } from "node:readline/promises";
import process from "node:process";
import type { WizardAnswers } from "./types.js";
import {
  validateEndDate,
  validateExistingPath,
  validateProjectName,
  validateTargetContributions,
} from "./validate.js";

interface PromptContext {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

const TARGET_OPTIONS = [
  { id: "100", label: "100 (dev/testing)" },
  { id: "500", label: "500 (recommended)" },
  { id: "1000", label: "1000 (high security)" },
  { id: "custom", label: "Custom value" },
];

/**
 * Runs the interactive wizard prompts, collecting project name, target contributions,
 * end date, and optional circuit path.
 *
 * @param context - Optional I/O streams for prompts (defaults to stdin/stdout)
 * @returns Promise resolving to WizardAnswers with all collected values
 *
 * @example
 * const answers = await askWizardQuestions();
 * console.log(answers.projectName);
 */
export async function askWizardQuestions(
  context: PromptContext = {},
): Promise<WizardAnswers> {
  const rl = createInterface({
    input: context.input ?? process.stdin,
    output: context.output ?? process.stdout,
  });

  try {
    const projectName = await askWithValidation(
      rl,
      "1) Project name (displayed in the ceremony UI): ",
      validateProjectName,
    );

    const targetContributions = await askTargetContributions(rl);

    const endDate = await askWithValidation(
      rl,
      "3) End date (optional YYYY-MM-DD, press enter to skip): ",
      validateEndDate,
    );

    let circuitArtifactsPath: string | null = null;
    for (;;) {
      const circuitPathRaw = await rl.question(
        "4) Circuit artifacts path (optional, press enter to skip): ",
      );
      const trimmed = circuitPathRaw.trim();
      if (!trimmed) {
        break;
      }
      try {
        circuitArtifactsPath = await validateExistingPath(
          trimmed,
          "Circuit artifacts",
        );
        break;
      } catch (error) {
        rl.write(`${toMessage(error)}\n`);
      }
    }

    return {
      projectName,
      targetContributions,
      endDate,
      circuitArtifactsPath,
    };
  } finally {
    rl.close();
  }
}

async function askTargetContributions(
  rl: ReturnType<typeof createInterface>,
): Promise<number> {
  for (;;) {
    rl.write("\n2) Target contributions:\n");
    TARGET_OPTIONS.forEach((option, index) => {
      rl.write(`   ${index + 1}. ${option.label}\n`);
    });

    const optionRaw = await rl.question("Select an option (1-4): ");
    const selectedNumber = parseWholeNumber(optionRaw);
    const selectedIndex =
      typeof selectedNumber === "number" ? selectedNumber - 1 : Number.NaN;

    if (
      Number.isNaN(selectedIndex) ||
      selectedIndex < 0 ||
      selectedIndex >= TARGET_OPTIONS.length
    ) {
      rl.write("Please choose a valid option number.\n\n");
      continue;
    }

    const selected = TARGET_OPTIONS[selectedIndex];
    if (selected.id !== "custom") {
      return validateTargetContributions(Number.parseInt(selected.id, 10));
    }

    const customValueRaw = await rl.question(
      "Enter a custom target contribution count: ",
    );
    const customValue = parseWholeNumber(customValueRaw);
    if (typeof customValue !== "number") {
      rl.write("Target contributions must be a whole number.\n\n");
      continue;
    }

    try {
      return validateTargetContributions(customValue);
    } catch (error) {
      rl.write(`${toMessage(error)}\n\n`);
    }
  }
}

async function askWithValidation<T>(
  rl: ReturnType<typeof createInterface>,
  question: string,
  validate: (value: string) => T | Promise<T>,
): Promise<T> {
  for (;;) {
    const answer = await rl.question(question);
    try {
      return await validate(answer);
    } catch (error) {
      rl.write(`${toMessage(error)}\n`);
    }
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseWholeNumber(rawValue: string): number | null {
  const trimmed = rawValue.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const numericValue = Number(trimmed);
  if (!Number.isSafeInteger(numericValue)) {
    return null;
  }

  return numericValue;
}
