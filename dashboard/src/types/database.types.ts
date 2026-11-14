// Provisional migration-derived types for F-101.
// Replace this file with the output of:
// supabase gen types typescript --linked > supabase/types/database.types.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      reports: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          reporter_id: string | null;
          status: 'uploaded' | 'processing' | 'ready' | 'failed' | 'needs_review' | 'duplicate';
          image_path: string;
          location: unknown;
          latitude: number;
          longitude: number;
          location_source: 'gps';
          address_label: string | null;
          road_type: string;
          damage_type: 'pothole' | 'crack' | 'surface_damage' | 'other' | 'unknown';
          severity: number | null;
          confidence: number | null;
          ai_summary: string | null;
          priority_score: number | null;
          priority_band: 'low' | 'medium' | 'high' | 'urgent' | null;
          score_version: string | null;
          corroboration_count: number;
          duplicate_of: string | null;
          duplicate_distance_m: number | null;
          needs_human_review: boolean;
          processing_error: string | null;
          source: 'citizen' | 'seeded_demo';
        };
        Insert: Partial<Database['public']['Tables']['reports']['Row']> & {
          image_path: string;
          latitude: number;
          longitude: number;
        };
        Update: Partial<Database['public']['Tables']['reports']['Row']>;
        Relationships: [];
      };
      report_confirmations: {
        Row: {
          id: string;
          original_report_id: string;
          corroborating_report_id: string;
          reporter_id: string;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['report_confirmations']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['report_confirmations']['Insert']>;
        Relationships: [];
      };
      geocode_cache: {
        Row: {
          cache_key: string;
          latitude_rounded: number;
          longitude_rounded: number;
          address_label: string | null;
          road_type: string;
          fetched_at: string;
        };
        Insert: Database['public']['Tables']['geocode_cache']['Row'];
        Update: Partial<Database['public']['Tables']['geocode_cache']['Insert']>;
        Relationships: [];
      };
    };
    Views: {
      public_reports: {
        Row: Pick<Database['public']['Tables']['reports']['Row'],
          'id' | 'created_at' | 'latitude' | 'longitude' | 'address_label' | 'road_type' |
          'damage_type' | 'severity' | 'priority_score' | 'priority_band' |
          'corroboration_count' | 'status' | 'source'>;
      };
    };
    Functions: {
      find_nearby_report: {
        Args: {
          p_lat: number;
          p_lon: number;
          p_radius_m: number;
          p_damage_type: string;
          p_exclude_id?: string | null;
        };
        Returns: { candidate_id: string; distance_m: number; damage_type: string }[];
      };
      add_report_corroboration: {
        Args: {
          p_original_report_id: string;
          p_corroborating_report_id: string;
          p_reporter_id: string;
        };
        Returns: {
          original_report_id: string;
          corroboration_count: number;
          priority_score: number | null;
          priority_band: string | null;
          inserted: boolean;
        }[];
      };
    };
  };
};
