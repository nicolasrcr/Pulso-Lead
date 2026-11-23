import { buildApp } from "./app.ts";

const port = Number(process.env.PORT ?? 3000);
buildApp().listen({ port, host: "0.0.0.0" }).then(() => console.log(`api em :${port}`));
