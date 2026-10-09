// 本文件由 P2 重构自 electron/main.cjs 机械搬迁（scripts/refactor-split.cjs），逻辑未改动。
"use strict";


const VECTOR_DIMENSIONS = 384;

const CHUNK_SIZE = 500;

const CHUNK_OVERLAP = 100;

const DEFAULT_CHAT_BASE_URL = "https://api.deepseek.com/v1";

const DEFAULT_EMBEDDING_BASE_URL = "https://api.openai.com/v1";

const DEFAULT_PROJECT_NAME = "默认小说项目";

const MAX_CHAT_TOKENS = 393216;

const MAX_RETRIEVAL_TOP_K = 1000;

const MAX_RETRIEVAL_SCAN_K = 50000;

const DEFAULT_RETRIEVAL_SCAN_K = 5000;

const CHAT_CONTEXT_MIN_CHUNKS = 30;

const CHAT_CONTEXT_CHAR_BUDGET = 130000;

const CHAT_API_TIMEOUT_MS = Number(process.env.NOVEL_CHAT_TIMEOUT_MS || 0);

const CHAT_HISTORY_MESSAGE_MAX_CHARS = 3500;

const CHAT_HISTORY_TOTAL_MAX_CHARS = 14000;

const USER_QUESTION_SYSTEM_PREVIEW_CHARS = 1200;

const SELECTED_TEXT_PROMPT_MAX_CHARS = 12000;

const STRUCTURING_CONTEXT_CHAR_BUDGET = 45000;

const DEFAULT_CATEGORY = "未分类";

const EMBEDDING_INDEX_CONCURRENCY = 4;

const CREDENTIAL_CHAT_REF = "credential://windows/chat";

const CREDENTIAL_EMBEDDING_REF = "credential://windows/embedding";


const __moduleExports = {
  VECTOR_DIMENSIONS,
  CHUNK_SIZE,
  CHUNK_OVERLAP,
  DEFAULT_CHAT_BASE_URL,
  DEFAULT_EMBEDDING_BASE_URL,
  DEFAULT_PROJECT_NAME,
  MAX_CHAT_TOKENS,
  MAX_RETRIEVAL_TOP_K,
  MAX_RETRIEVAL_SCAN_K,
  DEFAULT_RETRIEVAL_SCAN_K,
  CHAT_CONTEXT_MIN_CHUNKS,
  CHAT_CONTEXT_CHAR_BUDGET,
  CHAT_API_TIMEOUT_MS,
  CHAT_HISTORY_MESSAGE_MAX_CHARS,
  CHAT_HISTORY_TOTAL_MAX_CHARS,
  USER_QUESTION_SYSTEM_PREVIEW_CHARS,
  SELECTED_TEXT_PROMPT_MAX_CHARS,
  STRUCTURING_CONTEXT_CHAR_BUDGET,
  DEFAULT_CATEGORY,
  EMBEDDING_INDEX_CONCURRENCY,
  CREDENTIAL_CHAT_REF,
  CREDENTIAL_EMBEDDING_REF,
};

// Augment the original exports object so cyclic requires (whose captured
// reference may be a Proxy over the pre-assignment exports) see every key.
Object.assign(module.exports, __moduleExports);
module.exports = __moduleExports;
