/** Type surface of docs/njs/rpc-filter.js for the Node unit test (the script itself runs in nginx njs). */
export interface RpcVerdict {
  status: number;
  body: string;
}

export interface NjsSubrequestReply {
  status: number;
  responseText: string;
  headersOut: Record<string, string | undefined>;
}

export interface NjsRequest {
  requestText?: string;
  headersOut: Record<string, string | undefined>;
  return(status: number, body?: string): void;
  error(message: string): void;
  subrequest(uri: string, options: { method: string; body?: string }): Promise<NjsSubrequestReply>;
}

declare const rpcfilter: {
  rpc(r: NjsRequest): void;
  classify(bodyText: string | undefined | null): RpcVerdict | null;
  isForbidden(method: string): boolean;
  FORBIDDEN_PREFIXES: string[];
  FORBIDDEN_MESSAGE: string;
};

export default rpcfilter;
