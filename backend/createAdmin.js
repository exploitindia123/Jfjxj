const admin = require('./firebase-admin');

async function createAdmin() {
  try {
    const email = 'admin@example.com';   // Apna admin email yahan daalo
    const password = 'Admin@123456';     // Apna strong password yahan daalo

    // Check karo user pehle se hai ya nahi
    let user;
    try {
      user = await admin.auth().getUserByEmail(email);
      console.log('⚠️  User already exists:', user.uid);
    } catch (err) {
      // User nahi mila toh naya banao
      user = await admin.auth().createUser({
        email: email,
        password: password,
        emailVerified: true,
      });
      console.log('✅ Admin user created:', user.uid);
    }

    // Agar aapke paas Firestore mein 'users' collection hai, toh admin flag set karo
    await admin.firestore().collection('users').doc(user.uid).set({
      email: email,
      role: 'admin',
      isAdmin: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log('🎉 Admin setup complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

createAdmin();
