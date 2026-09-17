import { buildCliCommands } from "./features/device-auth/adapters/CliCommandsAdapter";

await buildCliCommands().parseAsync(process.argv);
