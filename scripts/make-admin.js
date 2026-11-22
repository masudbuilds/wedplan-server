import "dotenv/config";
import { connectDB, getUsersCollection, closeDB } from "../src/config/db.js";

async function makeAdmin() {
  const emailArg = process.argv[2];

  if (!emailArg || !emailArg.trim()) {
    console.error("Error: Please provide a user email address.");
    console.log("Usage: npm run make-admin -- someone@example.com");
    process.exit(1);
  }

  const email = emailArg.trim();

  try {
    console.log("Connecting to database...");
    await connectDB();
    const usersCollection = getUsersCollection();

    // Look up user by email (case-insensitive)
    const user = await usersCollection.findOne({
      email: { $regex: `^${email.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")}$`, $options: "i" },
    });

    if (!user) {
      console.error(`Error: User with email "${email}" was not found in the users collection.`);
      console.log("Note: Users must register via the frontend first before being promoted to admin.");
      await closeDB();
      process.exit(1);
    }

    // Set role to admin
    await usersCollection.updateOne(
      { _id: user._id },
      { $set: { role: "admin" } }
    );

    console.log("--------------------------------------------------");
    console.log(`SUCCESS: User "${user.email}" (ID: ${user._id}) has been updated to role "admin".`);
    console.log("--------------------------------------------------");
  } catch (error) {
    console.error("An error occurred while updating user role:", error.message);
  } finally {
    await closeDB();
  }
}

makeAdmin();
