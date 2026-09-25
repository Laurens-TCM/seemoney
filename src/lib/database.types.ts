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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      dismissed_suggestions: {
        Row: {
          from_date: string
          household_id: string
          id: string
          to_date: string
        }
        Insert: {
          from_date: string
          household_id: string
          id?: string
          to_date: string
        }
        Update: {
          from_date?: string
          household_id?: string
          id?: string
          to_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "dismissed_suggestions_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          amount: number | null
          household_id: string
          id: string
          name: string
          saved: number | null
          sort: number | null
          target_month: string | null
        }
        Insert: {
          amount?: number | null
          household_id: string
          id?: string
          name?: string
          saved?: number | null
          sort?: number | null
          target_month?: string | null
        }
        Update: {
          amount?: number | null
          household_id?: string
          id?: string
          name?: string
          saved?: number | null
          sort?: number | null
          target_month?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goals_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      household_members: {
        Row: {
          display_name: string | null
          household_id: string
          user_id: string
        }
        Insert: {
          display_name?: string | null
          household_id: string
          user_id: string
        }
        Update: {
          display_name?: string | null
          household_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      imports: {
        Row: {
          created_at: string | null
          from_date: string
          household_id: string
          id: string
          line_count: number | null
          skipped_count: number | null
          skipped_reasons: Json | null
          source_filename: string | null
          to_date: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string | null
          from_date: string
          household_id: string
          id?: string
          line_count?: number | null
          skipped_count?: number | null
          skipped_reasons?: Json | null
          source_filename?: string | null
          to_date: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string | null
          from_date?: string
          household_id?: string
          id?: string
          line_count?: number | null
          skipped_count?: number | null
          skipped_reasons?: Json | null
          source_filename?: string | null
          to_date?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "imports_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      line_overrides: {
        Row: {
          category: string | null
          household_id: string
          kind: Database["public"]["Enums"]["line_kind"] | null
          note: string | null
          tx_id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          category?: string | null
          household_id: string
          kind?: Database["public"]["Enums"]["line_kind"] | null
          note?: string | null
          tx_id: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          category?: string | null
          household_id?: string
          kind?: Database["public"]["Enums"]["line_kind"] | null
          note?: string | null
          tx_id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "line_overrides_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      lines: {
        Row: {
          account: string | null
          amount: number
          bucket: string | null
          category: string | null
          date: string
          grp: string | null
          household_id: string
          import_id: string | null
          income_source: string | null
          kind: Database["public"]["Enums"]["line_kind"]
          label: string | null
          loc: string | null
          name: string
          needs_review: boolean | null
          review: string | null
          tx_id: string
        }
        Insert: {
          account?: string | null
          amount: number
          bucket?: string | null
          category?: string | null
          date: string
          grp?: string | null
          household_id: string
          import_id?: string | null
          income_source?: string | null
          kind: Database["public"]["Enums"]["line_kind"]
          label?: string | null
          loc?: string | null
          name: string
          needs_review?: boolean | null
          review?: string | null
          tx_id: string
        }
        Update: {
          account?: string | null
          amount?: number
          bucket?: string | null
          category?: string | null
          date?: string
          grp?: string | null
          household_id?: string
          import_id?: string | null
          income_source?: string | null
          kind?: Database["public"]["Enums"]["line_kind"]
          label?: string | null
          loc?: string | null
          name?: string
          needs_review?: boolean | null
          review?: string | null
          tx_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lines_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lines_import_id_household_id_fkey"
            columns: ["import_id", "household_id"]
            isOneToOne: false
            referencedRelation: "imports"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      settings: {
        Row: {
          business_owed_as_of: string | null
          business_owed_before: number | null
          household_id: string
          offset_as_of: string | null
          offset_balance: number | null
        }
        Insert: {
          business_owed_as_of?: string | null
          business_owed_before?: number | null
          household_id: string
          offset_as_of?: string | null
          offset_balance?: number | null
        }
        Update: {
          business_owed_as_of?: string | null
          business_owed_before?: number | null
          household_id?: string
          offset_as_of?: string | null
          offset_balance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "settings_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: true
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      targets: {
        Row: {
          grp: string
          household_id: string
          monthly_target: number | null
          trimmable: boolean | null
        }
        Insert: {
          grp: string
          household_id: string
          monthly_target?: number | null
          trimmable?: boolean | null
        }
        Update: {
          grp?: string
          household_id?: string
          monthly_target?: number | null
          trimmable?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "targets_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_overrides: {
        Row: {
          household_id: string
          included: boolean
          trip_id: string
          tx_id: string
        }
        Insert: {
          household_id: string
          included: boolean
          trip_id: string
          tx_id: string
        }
        Update: {
          household_id?: string
          included?: boolean
          trip_id?: string
          tx_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_overrides_trip_id_household_id_fkey"
            columns: ["trip_id", "household_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id", "household_id"]
          },
        ]
      }
      trips: {
        Row: {
          created_at: string | null
          created_by: string | null
          end_date: string
          household_id: string
          id: string
          kind: string
          name: string
          place: string
          recharge_to_business: boolean | null
          start_date: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          end_date: string
          household_id: string
          id?: string
          kind?: string
          name: string
          place?: string
          recharge_to_business?: boolean | null
          start_date: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          end_date?: string
          household_id?: string
          id?: string
          kind?: string
          name?: string
          place?: string
          recharge_to_business?: boolean | null
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "trips_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      user_settings: {
        Row: {
          hide_trips: boolean | null
          household_id: string
          user_id: string
          window_months: number | null
        }
        Insert: {
          hide_trips?: boolean | null
          household_id: string
          user_id: string
          window_months?: number | null
        }
        Update: {
          hide_trips?: boolean | null
          household_id?: string
          user_id?: string
          window_months?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "user_settings_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_member: { Args: { h: string }; Returns: boolean }
    }
    Enums: {
      line_kind:
        | "income"
        | "other_in"
        | "spend"
        | "internal"
        | "loan_in"
        | "business_loan"
        | "business_loan_repaid"
        | "capital"
        | "excluded"
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
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      line_kind: [
        "income",
        "other_in",
        "spend",
        "internal",
        "loan_in",
        "business_loan",
        "business_loan_repaid",
        "capital",
        "excluded",
      ],
    },
  },
} as const
