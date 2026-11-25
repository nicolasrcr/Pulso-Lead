import type { ApiClient, Me } from "../api";
export interface PageProps { api: ApiClient; me: Me; projectId: string; caps: string[] }
