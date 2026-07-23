export type UserRead = {
  user_id: string;
  email: string;
  display_name: string | null;
  role: string;
  user_instructions: string | null;
  created_at: string;
};

export type PermanentDocumentRead = {
  nombre: string;
  resumen: string;
  ruta_completa?: string;
};

export type AllowedSchemasResponse = {
  allowed_tables: string[];
  schemas: Array<{ schema: string; descripcion: string | null }>;
};
