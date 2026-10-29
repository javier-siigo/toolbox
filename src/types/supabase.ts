export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  anticipos: {
    Tables: {
      registros: {
        Row: {
          created_at: string
          created_by: string
          es_retirado: boolean
          falta: Database["anticipos"]["Enums"]["falta"]
          fecha_gestion: string | null
          fecha_rq: string
          id: string
          nombre: string
          nombre_normalizado: string | null
          observacion_1: Database["anticipos"]["Enums"]["observacion_1"]
          observacion_2: string | null
          requerimiento: string
          retiro_cedula: number | null
          retiro_nivel: string | null
          retiro_tokens_comunes: string[] | null
          retiro_tokens_extra: string[] | null
          updated_at: string
          updated_by: string
        }
        Insert: {
          created_at?: string
          created_by: string
          falta: Database["anticipos"]["Enums"]["falta"]
          fecha_gestion?: string | null
          fecha_rq: string
          id?: string
          nombre: string
          observacion_1: Database["anticipos"]["Enums"]["observacion_1"]
          observacion_2?: string | null
          requerimiento: string
          retiro_cedula?: number | null
          retiro_nivel?: string | null
          retiro_tokens_comunes?: string[] | null
          retiro_tokens_extra?: string[] | null
          updated_at?: string
          updated_by: string
        }
        Update: {
          created_at?: string
          created_by?: string
          falta?: Database["anticipos"]["Enums"]["falta"]
          fecha_gestion?: string | null
          fecha_rq?: string
          id?: string
          nombre?: string
          observacion_1?: Database["anticipos"]["Enums"]["observacion_1"]
          observacion_2?: string | null
          requerimiento?: string
          retiro_cedula?: number | null
          retiro_nivel?: string | null
          retiro_tokens_comunes?: string[] | null
          retiro_tokens_extra?: string[] | null
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "registros_retiro_cedula_fkey"
            columns: ["retiro_cedula"]
            isOneToOne: false
            referencedRelation: "retirados"
            referencedColumns: ["cedula"]
          },
        ]
      }
      retirados: {
        Row: {
          cedula: number
          created_at: string
          fecha_reporte: string
          nombre: string
          nombre_normalizado: string | null
          observacion: string | null
          tokens: string[] | null
          valor: number | null
        }
        Insert: {
          cedula: number
          created_at?: string
          fecha_reporte?: string
          nombre: string
          observacion?: string | null
          valor?: number | null
        }
        Update: {
          cedula?: number
          created_at?: string
          fecha_reporte?: string
          nombre?: string
          observacion?: string | null
          valor?: number | null
        }
        Relationships: []
      }
      retirados_imports: {
        Row: {
          errors: number
          file_name: string
          file_size: number
          id: string
          imported_at: string
          imported_by: string | null
          total_rows: number
          upserted: number
        }
        Insert: {
          errors?: number
          file_name: string
          file_size: number
          id?: string
          imported_at?: string
          imported_by?: string | null
          total_rows: number
          upserted?: number
        }
        Update: {
          errors?: number
          file_name?: string
          file_size?: number
          id?: string
          imported_at?: string
          imported_by?: string | null
          total_rows?: number
          upserted?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      match_colaborador_retirado: {
        Args: { p_input: string }
        Returns: {
          cedula: number
          fecha_reporte: string
          nivel: string
          nombre: string
          observacion: string
          tokens_comunes: string[]
          tokens_extra: string[]
          valor: number
        }[]
      }
      match_colaborador_retirado_batch: {
        Args: { p_inputs: string[] }
        Returns: {
          cedula: number
          fecha_reporte: string
          nivel: string
          nombre: string
          observacion: string
          query: string
          tokens_comunes: string[]
          tokens_extra: string[]
          valor: number
        }[]
      }
    }
    Enums: {
      falta:
        | "permisos_de_soportes"
        | "revisar_descuento_nomina"
        | "autorizacion_descuento_nomina"
        | "legalizado"
        | "revisar_soportes"
        | "devolucion"
        | "autorizacion_soportes"
        | "revisar_con_harold"
        | "soportes"
      observacion_1:
        | "no_se_ha_contactado"
        | "escrito_1_vez"
        | "escrito_2_veces"
        | "escrito_3_veces"
        | "legalizado"
        | "correo_al_lider"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  comisiones: {
    Tables: {
      bases: {
        Row: {
          facturas: number
          notas_credito: number
          periodo: string
          prefijo: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          facturas?: number
          notas_credito?: number
          periodo: string
          prefijo: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          facturas?: number
          notas_credito?: number
          periodo?: string
          prefijo?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      cierres: {
        Row: {
          archivo_nombre: string
          archivo_tamano: number
          asientos: Json
          controles: Json
          created_at: string
          created_by: string | null
          diferido_nuevo: number
          gasto_mes: number
          id: string
          periodo: string
          saldo_diferido: number
        }
        Insert: {
          archivo_nombre: string
          archivo_tamano: number
          asientos?: Json
          controles?: Json
          created_at?: string
          created_by?: string | null
          diferido_nuevo: number
          gasto_mes: number
          id?: string
          periodo: string
          saldo_diferido: number
        }
        Update: {
          archivo_nombre?: string
          archivo_tamano?: number
          asientos?: Json
          controles?: Json
          created_at?: string
          created_by?: string | null
          diferido_nuevo?: number
          gasto_mes?: number
          id?: string
          periodo?: string
          saldo_diferido?: number
        }
        Relationships: []
      }
      conceptos: {
        Row: {
          activo: boolean
          created_at: string
          created_by: string | null
          cuenta: string | null
          id: string
          nombre: string
          orden: number
          updated_at: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          created_by?: string | null
          cuenta?: string | null
          id?: string
          nombre: string
          orden?: number
          updated_at?: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          created_by?: string | null
          cuenta?: string | null
          id?: string
          nombre?: string
          orden?: number
          updated_at?: string
        }
        Relationships: []
      }
      gasto_registrado: {
        Row: {
          cohorte: string
          concepto_id: string
          gasto: number
          motivo: string
          periodo: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cohorte: string
          concepto_id: string
          gasto: number
          motivo: string
          periodo: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cohorte?: string
          concepto_id?: string
          gasto?: number
          motivo?: string
          periodo?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comisiones_gasto_registrado_concepto_id_fkey"
            columns: ["concepto_id"]
            isOneToOne: false
            referencedRelation: "conceptos"
            referencedColumns: ["id"]
          },
        ]
      }
      periodo_valores: {
        Row: {
          concepto_id: string
          periodo: string
          updated_at: string
          updated_by: string | null
          valor: number
        }
        Insert: {
          concepto_id: string
          periodo: string
          updated_at?: string
          updated_by?: string | null
          valor?: number
        }
        Update: {
          concepto_id?: string
          periodo?: string
          updated_at?: string
          updated_by?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "comisiones_periodo_valores_concepto_id_fkey"
            columns: ["concepto_id"]
            isOneToOne: false
            referencedRelation: "conceptos"
            referencedColumns: ["id"]
          },
        ]
      }
      reconocimientos: {
        Row: {
          cohorte: string
          fuente: string
          ingreso: number
          pendiente_ingreso: number | null
          periodo: string
          prefijo: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cohorte: string
          fuente?: string
          ingreso: number
          pendiente_ingreso?: number | null
          periodo: string
          prefijo: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cohorte?: string
          fuente?: string
          ingreso?: number
          pendiente_ingreso?: number | null
          periodo?: string
          prefijo?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      guardar_cierre: {
        Args: { p_cierre: Json; p_periodo: string; p_reconocimientos: Json }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  conciliaciones: {
    Tables: {
      bancos: {
        Row: {
          activo: boolean
          created_at: string
          descripcion: string | null
          es_particular: boolean
          id: string
          nombre: string
          orden: number
          pais: string
          slug: string
          updated_at: string
          webhook_url: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          descripcion?: string | null
          es_particular?: boolean
          id?: string
          nombre: string
          orden?: number
          pais: string
          slug: string
          updated_at?: string
          webhook_url: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          descripcion?: string | null
          es_particular?: boolean
          id?: string
          nombre?: string
          orden?: number
          pais?: string
          slug?: string
          updated_at?: string
          webhook_url?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  core: {
    Tables: {
      permisos: {
        Row: {
          nivel: Database["core"]["Enums"]["nivel_acceso"]
          otorgado_at: string
          otorgado_por: string | null
          proceso_id: string
          user_id: string
        }
        Insert: {
          nivel?: Database["core"]["Enums"]["nivel_acceso"]
          otorgado_at?: string
          otorgado_por?: string | null
          proceso_id: string
          user_id: string
        }
        Update: {
          nivel?: Database["core"]["Enums"]["nivel_acceso"]
          otorgado_at?: string
          otorgado_por?: string | null
          proceso_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "permisos_proceso_id_fkey"
            columns: ["proceso_id"]
            isOneToOne: false
            referencedRelation: "procesos"
            referencedColumns: ["id"]
          },
        ]
      }
      procesos: {
        Row: {
          activo: boolean
          area: string
          id: string
          nombre: string
          pais: string | null
        }
        Insert: {
          activo?: boolean
          area: string
          id: string
          nombre: string
          pais?: string | null
        }
        Update: {
          activo?: boolean
          area?: string
          id?: string
          nombre?: string
          pais?: string | null
        }
        Relationships: []
      }
      user_activity: {
        Row: {
          last_seen_at: string
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          user_id: string
        }
        Update: {
          last_seen_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          paises: string[]
          roles: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          paises?: string[]
          roles?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          paises?: string[]
          roles?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      usuarios: {
        Row: {
          es_admin: boolean
          user_id: string
        }
        Insert: {
          es_admin?: boolean
          user_id: string
        }
        Update: {
          es_admin?: boolean
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      guardar_permisos: {
        Args: {
          p_es_admin: boolean
          p_otorgado_por: string
          p_permisos: Json
          p_user_id: string
        }
        Returns: undefined
      }
      storage_archivos_vencidos: {
        Args: { p_antes: string; p_buckets: string[] }
        Returns: {
          bucket_id: string
          name: string
        }[]
      }
      touch_last_seen: { Args: never; Returns: undefined }
    }
    Enums: {
      nivel_acceso: "ver" | "usar" | "gestionar"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  export_bancos: {
    Tables: {
      campo_valores: {
        Row: {
          actualizado_at: string
          campo_id: string
          desde: string
          dias_sin_datos: number
          distintos: number
          hasta: string
          truncado: boolean
          valores: Json
        }
        Insert: {
          actualizado_at?: string
          campo_id: string
          desde: string
          dias_sin_datos?: number
          distintos?: number
          hasta: string
          truncado?: boolean
          valores?: Json
        }
        Update: {
          actualizado_at?: string
          campo_id?: string
          desde?: string
          dias_sin_datos?: number
          distintos?: number
          hasta?: string
          truncado?: boolean
          valores?: Json
        }
        Relationships: [
          {
            foreignKeyName: "netsuite_campo_valores_campo_id_fkey"
            columns: ["campo_id"]
            isOneToOne: true
            referencedRelation: "campos"
            referencedColumns: ["id"]
          },
        ]
      }
      campos: {
        Row: {
          campo: string
          created_at: string
          created_by: string | null
          etiqueta: string
          habilitado: boolean
          id: string
          modo: string
          orden: number
          tabla: string
          tipo: string
          updated_at: string
        }
        Insert: {
          campo: string
          created_at?: string
          created_by?: string | null
          etiqueta: string
          habilitado?: boolean
          id?: string
          modo?: string
          orden?: number
          tabla: string
          tipo?: string
          updated_at?: string
        }
        Update: {
          campo?: string
          created_at?: string
          created_by?: string | null
          etiqueta?: string
          habilitado?: boolean
          id?: string
          modo?: string
          orden?: number
          tabla?: string
          tipo?: string
          updated_at?: string
        }
        Relationships: []
      }
      plantillas: {
        Row: {
          campos: string[]
          created_at: string
          created_by: string | null
          filtros: Json
          id: string
          nombre: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          campos?: string[]
          created_at?: string
          created_by?: string | null
          filtros?: Json
          id?: string
          nombre: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          campos?: string[]
          created_at?: string
          created_by?: string | null
          filtros?: Json
          id?: string
          nombre?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : never

export const Constants = {
  anticipos: {
    Enums: {
      falta: [
        "permisos_de_soportes",
        "revisar_descuento_nomina",
        "autorizacion_descuento_nomina",
        "legalizado",
        "revisar_soportes",
        "devolucion",
        "autorizacion_soportes",
        "revisar_con_harold",
        "soportes",
      ],
      observacion_1: [
        "no_se_ha_contactado",
        "escrito_1_vez",
        "escrito_2_veces",
        "escrito_3_veces",
        "legalizado",
        "correo_al_lider",
      ],
    },
  },
  comisiones: {
    Enums: {},
  },
  conciliaciones: {
    Enums: {},
  },
  core: {
    Enums: {
      nivel_acceso: ["ver", "usar", "gestionar"],
    },
  },
  export_bancos: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
