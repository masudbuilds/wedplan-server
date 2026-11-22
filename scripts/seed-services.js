import "dotenv/config";
import { connectDB, getServicesCollection, closeDB } from "../src/config/db.js";

/**
 * Temporary Sample Data for WedPlan
 * Aligned with the 6 assignment categories and client mock data.
 * Placeholder vendorId is used; attachVendorDetails in the backend handles
 * missing vendors gracefully without throwing errors.
 */
const SAMPLE_SERVICES = [
  {
    vendorId: "placeholder-vendor-1",
    vendorName: "Julian & Co. Photography",
    vendorImage: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80",
    serviceName: "Editorial Wedding Photo & Cinema",
    category: "Photography & Videography",
    description: "Full-day fine art photography, cinematic 4K highlight film, and aerial drone coverage crafted for timeless romance.",
    price: 3200,
    location: "New York, NY",
    images: [
      "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1583939003579-730e3918a45a?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1511285560929-80b456fea0bc?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1537633552985-df8429e8048b?auto=format&fit=crop&w=1200&q=80",
    ],
    status: "approved",
    isActive: true,
    isSeedData: true,
    createdAt: new Date("2026-01-10T09:00:00Z"),
  },
  {
    vendorId: "placeholder-vendor-2",
    vendorName: "Rosewood Glasshouse Estates",
    vendorImage: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80",
    serviceName: "Grand Conservatory & Botanical Gardens",
    category: "Wedding Venues",
    description: "Panoramic light-filled conservatory surrounded by 20 acres of manicured gardens, outdoor cocktail terrace, and bridal suite.",
    price: 8500,
    location: "Hudson Valley, NY",
    images: [
      "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1545232979-8bf68ee9b1af?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?auto=format&fit=crop&w=1200&q=80",
    ],
    status: "approved",
    isActive: true,
    isSeedData: true,
    createdAt: new Date("2026-01-14T11:30:00Z"),
  },
  {
    vendorId: "placeholder-vendor-3",
    vendorName: "Petal & Stem Floral Studio",
    vendorImage: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80",
    serviceName: "Romantic Bespoke Arches & Tablescapes",
    category: "Decoration & Florist",
    description: "Organic seasonal florals, dramatic ceremony arches, textured candlelight centerpieces, and delicate bridal party bouquets.",
    price: 2400,
    location: "Brooklyn, NY",
    images: [
      "https://images.unsplash.com/photo-1511285560929-80b456fea0bc?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1526047932273-341f2a7631f9?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1561181286-d3fee7d55364?auto=format&fit=crop&w=1200&q=80",
    ],
    status: "approved",
    isActive: true,
    isSeedData: true,
    createdAt: new Date("2026-01-20T14:15:00Z"),
  },
  {
    vendorId: "placeholder-vendor-4",
    vendorName: "Artisan Feast Catering",
    vendorImage: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=80",
    serviceName: "Farm-to-Table Multi-Course Wedding Banquet",
    category: "Catering Services",
    description: "Locally sourced seasonal dining experiences, artisanal passed hors d'oeuvres, signature mixology bar, and late-night bites.",
    price: 4900,
    location: "Greenwich, CT",
    images: [
      "https://images.unsplash.com/photo-1555244162-803834f70033?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1551218808-94e220e084d2?auto=format&fit=crop&w=1200&q=80",
    ],
    status: "approved",
    isActive: true,
    isSeedData: true,
    createdAt: new Date("2026-02-02T10:00:00Z"),
  },
  {
    vendorId: "placeholder-vendor-5",
    vendorName: "Lumière Bridal Beauty",
    vendorImage: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=200&q=80",
    serviceName: "Luminous Bridal Glam & Hair Styling",
    category: "Makeup & Styling",
    description: "Luxury on-location airbrush makeup, romantic soft-wave hair styling, preview trials, and touch-up concierge for the entire party.",
    price: 1350,
    location: "Manhattan, NY",
    images: [
      "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=1200&q=80",
    ],
    status: "approved",
    isActive: true,
    isSeedData: true,
    createdAt: new Date("2026-02-05T13:45:00Z"),
  },
  {
    vendorId: "placeholder-vendor-6",
    vendorName: "Atelier Blanche Couture",
    vendorImage: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=200&q=80",
    serviceName: "Custom Silk Bridal Gowns & Veil Styling",
    category: "Wedding Fashion",
    description: "Bespoke handcrafted French lace wedding gowns, tailored suits, hand-embroidered cathedral veils, and personalized fittings.",
    price: 3600,
    location: "SoHo, NY",
    images: [
      "https://images.unsplash.com/photo-1594552072238-b8a33785b261?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1532712938310-34cb3982ef74?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1515934751635-c81c6bc9a2d8?auto=format&fit=crop&w=1200&q=80",
    ],
    status: "approved",
    isActive: true,
    isSeedData: true,
    createdAt: new Date("2026-02-12T16:20:00Z"),
  },
  {
    vendorId: "placeholder-vendor-7",
    vendorName: "Evergreen Hilltop Pavilion",
    vendorImage: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=200&q=80",
    serviceName: "Rustic Elegance Barn & Vineyard",
    category: "Wedding Venues",
    description: "Sweeping vineyard views, restored historic timber barn, fairy-lit courtyards, and fire pits for evening celebrations.",
    price: 6800,
    location: "Finger Lakes, NY",
    images: [
      "https://images.unsplash.com/photo-1519225421980-715cb0215aed?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1511285560929-80b456fea0bc?auto=format&fit=crop&w=1200&q=80",
    ],
    status: "approved",
    isActive: true,
    isSeedData: true,
    createdAt: new Date("2026-02-15T08:30:00Z"),
  },
  {
    vendorId: "placeholder-vendor-8",
    vendorName: "Serenade Acoustic Strings",
    vendorImage: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=200&q=80",
    serviceName: "Classical String Quartet & Cocktail Trio",
    category: "Photography & Videography",
    description: "Live emotional ceremony accompaniment, modern pop arrangements for cocktail hour, and bespoke song requests.",
    price: 1850,
    location: "Philadelphia, PA",
    images: [
      "https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&w=1200&q=80",
    ],
    status: "approved",
    isActive: true,
    isSeedData: true,
    createdAt: new Date("2026-02-18T15:00:00Z"),
  },
];

async function seedServices() {
  try {
    console.log("Connecting to database...");
    await connectDB();
    const servicesCollection = getServicesCollection();

    // Remove any previously seeded sample data to avoid duplicates
    const deleteResult = await servicesCollection.deleteMany({ isSeedData: true });
    if (deleteResult.deletedCount > 0) {
      console.log(`Cleaned up ${deleteResult.deletedCount} existing sample seed records.`);
    }

    // Insert 8 sample services
    const insertResult = await servicesCollection.insertMany(SAMPLE_SERVICES);
    console.log("--------------------------------------------------");
    console.log(`SUCCESS: Inserted ${insertResult.insertedCount} sample approved services.`);
    console.log("Note: These are temporary sample records. When real vendors register,");
    console.log("their created services will link to actual vendor accounts.");
    console.log("--------------------------------------------------");
  } catch (error) {
    console.error("Failed to seed services:", error.message);
  } finally {
    await closeDB();
  }
}

seedServices();
