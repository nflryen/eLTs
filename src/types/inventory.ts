// Master Equipment & Asset Inventory Domain Types
// Strictly mirrors public.inventory_assets and extended public.project_expenses

export type AssetCategory =
  | "CAMERA"
  | "LENS"
  | "WIRELESS_VIDEO"
  | "BROADCAST_SWITCHER"
  | "AUDIO"
  | "INTERCOM"
  | "LIGHTING"
  | "SUPPORT_RIG"
  | "CABLE_ACCESSORY";

export type AssetSourceType =
  | "IN_HOUSE"        // Milik Studio KINEVA/ELTS
  | "PARTNER_OWNED"   // Milik Co-Founder / Partner (e.g. El, Cahyo)
  | "VENDOR_RENTAL";  // Sewa vendor luar (e.g. Koi Rental)

export type ConditionStatus =
  | "EXCELLENT"
  | "GOOD"
  | "FAIR"
  | "MAINTENANCE"
  | "RETIRED";

export type ReturnStatus =
  | "PENDING"
  | "RETURNED"
  | "OVERDUE";

export interface InventoryAssetRow {
  id: string;
  asset_code: string;
  name: string;
  category: AssetCategory;
  source_type: AssetSourceType;
  owner_name: string;
  vendor_name: string | null;
  vendor_phone: string | null;
  daily_rental_rate: number;
  replacement_value: number;
  serial_number: string | null;
  condition_status: ConditionStatus;
  is_available_for_outgoing_rental: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetConflictResult {
  conflict_found: boolean;
  conflicting_project_id: string;
  conflicting_project_name: string;
  conflicting_date?: string;
  conflict_type?: string;
}

export interface CreateInventoryAssetInput {
  asset_code?: string;
  name: string;
  category: AssetCategory;
  source_type: AssetSourceType;
  owner_name?: string;
  vendor_name?: string | null;
  vendor_phone?: string | null;
  daily_rental_rate: number;
  replacement_value?: number;
  serial_number?: string | null;
  condition_status?: ConditionStatus;
  is_available_for_outgoing_rental?: boolean;
  notes?: string | null;
}

export interface VendorRentalManifestItem {
  name: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  notes?: string | null;
}

export interface VendorRentalManifest {
  poNumber: string;
  vendorName: string;
  vendorPhone: string | null;
  projectName: string;
  eventDate: string | null;
  items: VendorRentalManifestItem[];
  totalAmount: number;
  whatsAppMessage: string;
}
