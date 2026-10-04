export type SearchEntityType = 'CASE' | 'INVOICE' | 'PAYMENT' | 'COURIER_DOCKET' | 'INVESTIGATOR';

export interface SearchResultItem {
  entity_type: SearchEntityType;
  entity_id: string;
  title: string;
  subtitle: string;
  doc_code: string;
  status: string;
  similarity_score: number;
  metadata: Record<string, unknown>;
}

export interface SearchQueryOptions {
  agency_id: string;
  query: string;
  entity_types?: SearchEntityType[];
  limit?: number;
  offset?: number;
  actor_user_id: string;
  caller_scope: 'ALL' | 'TEAM' | 'ASSIGNED' | 'OWN_ENTERED';
  subordinate_user_ids?: string[];
  owner_manager_id?: string;
  client_id?: string;
}

export interface SearchResponse {
  results: SearchResultItem[];
  total_count: number;
  query: string;
  duration_ms: number;
  has_more: boolean;
}
