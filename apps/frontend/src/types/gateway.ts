export type UserRead = {
  user_id: string;
  email: string;
  display_name: string | null;
  role: string;
  user_instructions: string | null;
  created_at: string;
};

export type GatewayUserEnsurePayload = {
  email: string;
  display_name?: string;
};

export type UserInstructionsUpdatePayload = {
  user_instructions: string | null;
};

export type AllowedAgentsResponse = {
  allowed_agents: string[];
};

export type AccessibleSchemaRead = {
  schema: string;
  descripcion: string | null;
};

export type AllowedSchemasResponse = {
  allowed_tables: string[];
  schemas: AccessibleSchemaRead[];
};

export type PermanentDocumentRead = {
  nombre: string;
  resumen: string;
  ruta_completa?: string;
};

export type ProjectRead = {
  project_id: string;
  name: string;
  description: string | null;
  global_instructions: string | null;
  created_at: string;
  deleted_at: string | null;
};

export type ProjectAccessLevel = "owner" | "editor" | "viewer";

export type ProjectMemberWithUserRead = {
  user_id: string;
  email: string;
  display_name: string | null;
  access_level: ProjectAccessLevel;
  joined_at: string;
};

export type ProjectCreatePayload = {
  name: string;
  global_instructions: string | null;
};

export type ProjectDescriptionUpdatePayload = {
  description: string | null;
};

export type ProjectInstructionsUpdatePayload = {
  global_instructions: string | null;
};

export type DocumentStatus = "processing" | "ready" | "failed";

export type ProjectDocumentRead = {
  doc_id: string;
  project_id: string;
  uploaded_by: string | null;
  filename: string;
  weaviate_source: string | null;
  chunk_count: number;
  status: DocumentStatus;
  uploaded_at: string;
};

export type ProjectDocumentUploadResponse = {
  doc_id: string;
  message: string;
};

export type ThreadAccess = "write" | "read";

export type ThreadRead = {
  thread_id: string;
  user_id: string;
  project_id: string | null;
  tool_used: string;
  thread_instructions: string | null;
  title: string | null;
  created_at: string;
  deleted_at: string | null;
  access: ThreadAccess | null;
};

export type MessageRead = {
  message_id: string;
  thread_id: string;
  role: string;
  content: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  model: string | null;
  created_at: string;
};

export type AgentStreamChatbiMode = {
  schema: "maka_bigquery";
  periodo: string;
  rule_id: string;
  scope_id?: string;
};

export type AgentStreamRequestBody = {
  thread_id: string;
  message: string;
  forced_agents: string[];
  project_id?: string | null;
  use_temp_docs?: boolean;
  internet_search?: boolean;
  force_internet_search?: boolean;
  skip_user_message_save?: boolean;
  chatbi_mode?: AgentStreamChatbiMode;
};

export type TemporaryDocumentRead = {
  nombre: string;
  chunks?: number;
};

export type TemporaryDocumentsUploadResponse = {
  status: string;
  message: string;
  documents: TemporaryDocumentRead[];
};

export type TemporaryDocumentsDeleteResponse = {
  status: string;
  message: string;
};

export type AgentStreamTokenEvent = {
  token: string;
  done?: boolean;
};

export type AgentStreamPlotlyEvent = {
  plotly_spec: unknown;
  done?: boolean;
};

export type AgentStreamErrorEvent = {
  error: string;
  done?: boolean;
};

export type AgentStreamNoopEvent = {
  done?: boolean;
};

export type AgentStreamSearchApprovalEvent = {
  search_approval_required: {
    query: string;
    reason: string;
    fallback_text: string;
  };
  done?: boolean;
};

export type AgentStreamRecordsEvent = {
  records: unknown[];
  done?: boolean;
};

export type AgentStreamSqlQueryEvent = {
  sql_query: string;
  done?: boolean;
};

export type AgentStreamEvent =
  | AgentStreamTokenEvent
  | AgentStreamPlotlyEvent
  | AgentStreamRecordsEvent
  | AgentStreamSqlQueryEvent
  | AgentStreamErrorEvent
  | AgentStreamSearchApprovalEvent
  | AgentStreamNoopEvent;
