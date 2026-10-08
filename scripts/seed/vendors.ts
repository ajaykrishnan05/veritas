// Deterministic synthetic vendor master. All names, tax IDs and bank suffixes are fictional.
export interface VendorSeed {
  code: string;
  legal: string;
  display: string;
  bank: string;
  taxRate: number | null;
  status: 'active' | 'inactive' | 'pending';
}

export const VENDORS: VendorSeed[] = [
  { code: 'V001', legal: 'Apex Office Supplies LLC', display: 'Apex Office Supplies', bank: '4821', taxRate: 8, status: 'active' },
  { code: 'V002', legal: 'Brightline Logistics Inc', display: 'Brightline Logistics', bank: '1177', taxRate: 6, status: 'active' },
  { code: 'V003', legal: 'Cobalt IT Services Ltd', display: 'Cobalt IT Services', bank: '7305', taxRate: 7.5, status: 'active' },
  { code: 'V004', legal: 'Delta Facility Maintenance Co', display: 'Delta Facilities', bank: '2290', taxRate: 8.5, status: 'active' },
  { code: 'V005', legal: 'Evergreen Printing Group', display: 'Evergreen Printing', bank: '6643', taxRate: 6, status: 'active' },
  { code: 'V006', legal: 'Falcon Industrial Parts Inc', display: 'Falcon Industrial', bank: '3158', taxRate: 7, status: 'active' },
  { code: 'V007', legal: 'Granite Legal Partners LLP', display: 'Granite Legal', bank: '9042', taxRate: 0, status: 'active' },
  { code: 'V008', legal: 'Harbor Freight Solutions Ltd', display: 'Harbor Freight Solutions', bank: '5516', taxRate: 6, status: 'active' },
  { code: 'V009', legal: 'Ironwood Furniture Co', display: 'Ironwood Furniture', bank: '8374', taxRate: 8, status: 'inactive' },
  { code: 'V010', legal: 'Juniper Cloud Hosting Inc', display: 'Juniper Cloud', bank: '2761', taxRate: 7.5, status: 'active' },
  { code: 'V011', legal: 'Keystone Security Systems LLC', display: 'Keystone Security', bank: '4093', taxRate: 8, status: 'active' },
  { code: 'V012', legal: 'Lumen Electrical Contractors Inc', display: 'Lumen Electrical', bank: '6218', taxRate: 8.5, status: 'active' },
  { code: 'V013', legal: 'Meridian Catering Services LLC', display: 'Meridian Catering', bank: '1935', taxRate: 7, status: 'active' },
  { code: 'V014', legal: 'Northwind Packaging Ltd', display: 'Northwind Packaging', bank: '7780', taxRate: 6, status: 'active' },
  { code: 'V015', legal: 'Orchid Cleaning Services Inc', display: 'Orchid Cleaning', bank: '3427', taxRate: 8, status: 'active' },
  { code: 'V016', legal: 'Pioneer Telecom Corp', display: 'Pioneer Telecom', bank: '5069', taxRate: 7.5, status: 'active' },
  { code: 'V017', legal: 'Quartz Engineering Consultants Ltd', display: 'Quartz Engineering', bank: '8852', taxRate: 0, status: 'active' },
  { code: 'V018', legal: 'Redwood Staffing Solutions LLC', display: 'Redwood Staffing', bank: '2604', taxRate: 0, status: 'active' },
  { code: 'V019', legal: 'Summit Fleet Services Inc', display: 'Summit Fleet', bank: '9137', taxRate: 6, status: 'active' },
  { code: 'V020', legal: 'Tidewater Chemical Supply Co', display: 'Tidewater Chemical', bank: '4471', taxRate: null, status: 'active' },
  { code: 'V021', legal: 'Union Marketing Agency LLC', display: 'Union Marketing', bank: '6905', taxRate: null, status: 'active' },
  { code: 'V022', legal: 'Vertex Software Licensing Inc', display: 'Vertex Software', bank: '1388', taxRate: null, status: 'active' },
  { code: 'V023', legal: 'Westgate Travel Management Ltd', display: 'Westgate Travel', bank: '7216', taxRate: 8, status: 'active' },
  { code: 'V024', legal: 'Northwind Packaging Limited', display: 'Northwind Packaging Ltd.', bank: '3369', taxRate: 6, status: 'pending' },
  { code: 'V025', legal: 'Zenith Equipment Rental Inc', display: 'Zenith Rental', bank: '8041', taxRate: 7, status: 'inactive' },
];

/** [description, base unit price]. Vendor i (0-based) sells pool items (3i..3i+2) mod 30. */
export const ITEM_POOL: Array<[string, number]> = [
  ['Copy paper case (10 reams)', 42],
  ['Toner cartridge, black', 96.5],
  ['Ink-jet multipack', 58],
  ['Pallet freight, regional', 185],
  ['Last-mile delivery, per stop', 14.75],
  ['Warehouse storage, per pallet-month', 28],
  ['Managed IT support, per seat-month', 65],
  ['Network switch configuration', 240],
  ['Cloud backup, per TB-month', 31],
  ['Monthly HVAC inspection', 310],
  ['Janitorial supplies restock', 126],
  ['Emergency plumbing call-out', 275],
  ['Brochure print run (1,000 units)', 420],
  ['Business cards (500)', 36],
  ['Large-format banner', 88],
  ['CNC bearing set', 154],
  ['Hydraulic hose assembly', 47.5],
  ['Industrial lubricant (5 gal)', 112],
  ['Contract review, per hour', 295],
  ['Document filing fee', 65],
  ['Courier freight, per shipment', 52],
  ['Ergonomic desk chair', 289],
  ['Standing desk frame', 410],
  ['Conference table', 1150],
  ['Server hosting, per node-month', 119],
  ['SSL certificate, annual', 88],
  ['CCTV camera install', 340],
  ['Badge reader unit', 215],
  ['Electrical panel inspection', 380],
  ['LED lighting retrofit, per fixture', 64],
];

export function catalogFor(vendorIndex: number): Array<[string, number]> {
  return [0, 1, 2].map((k) => ITEM_POOL[(vendorIndex * 3 + k) % ITEM_POOL.length]);
}
