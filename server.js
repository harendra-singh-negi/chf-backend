const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = 4242;

app.get("/health", (req, res) => {
  res.json({ message: "Server Health is Fine" });
});
// Middleware
app.use(cors());
app.use(express.json());

// Salesforce Config
const BASE_URL = process.env.API_SALESFORCE_INSTATE;
const API_VERSION = process.env.API_VERSION || "v57.0";
const DOMAIN = process.env.DOMAIN || "localhost:5173";
let accessToken = null;

// Salesforce Access Token Refresh
const refreshAccessToken = async () => {
  try {
    const response = await axios.post(
      `${BASE_URL}/services/oauth2/token`,
      null,
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        params: {
          grant_type: "password",
          client_id: process.env.API_SALESFORCE_CLIENT_ID,
          client_secret: process.env.API_SALESFORCE_CLIENT_SECRET,
          username: process.env.API_SALESFORCE_USER_NAME,
          password: process.env.API_SALESFORCE_USER_PASSWORD,
        },
      }
    );
    accessToken = response.data.access_token;
  } catch (error) {
    throw new Error("Failed to refresh Salesforce access token");
  }
};

// Ensure Salesforce Access Token Middleware
const ensureSalesforceAccessToken = async (req, res, next) => {
  try {
    await refreshAccessToken();
    req.headers["Authorization"] = `Bearer ${accessToken}`;
    next();
  } catch (error) {
    res.status(500).json({ message: "Salesforce authentication error", error });
  }
};

// Salesforce Helper
const salesforceRequest = async (method, endpoint, data = {}) => {
  try {
    const url = `${BASE_URL}/services/data/${API_VERSION}/${endpoint}`;
    const response = await axios({
      method,
      url,
      headers: { Authorization: `Bearer ${accessToken}` },
      data,
    });
    return response.data;
  } catch (error) {
    throw error.response ? error.response.data : error;
  }
};

// Utility Functions
const encryptVal = (clearText) => {
  return Buffer.from(clearText).toString("base64");
};

const decryptVal = (cipherText) => {
  return Buffer.from(cipherText, "base64").toString("utf-8");
};

const generateActivationToken = (email) => {
  const timestamp = Math.floor(Date.now() / 1000);
  return crypto
    .createHash("sha256")
    .update(`${email}${timestamp}`)
    .digest("hex");
};

// Routes
app.post(
  "/api/auth/register",
  ensureSalesforceAccessToken,
  async (req, res) => {
    const {
      firstname,
      lastname,
      emailid,
      usernumber,
      userpwd,
      userconfirmPassword,
      // qt_hiddenRecaptchaToken_signup,
    } = req.body;

    if (userpwd !== userconfirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    try {
      // Validate reCAPTCHA
      // const recaptchaResponse = await axios.post(
      //   "https://www.google.com/recaptcha/api/siteverify",
      //   null,
      //   {
      //     params: {
      //       secret: process.env.RECAPTCHA_SECRET_KEY,
      //       response: qt_hiddenRecaptchaToken_signup,
      //     },
      //   }
      // );

      // if (false) {
      //   return res
      //     .status(400)
      //     .json({ message: "reCAPTCHA verification failed" });
      // }

      // Check if Contact exists
      const recordTypeQuery =
        "SELECT Id FROM RecordType WHERE Name = 'Household Account'";
      const recordType = await salesforceRequest(
        "GET",
        `query?q=${encodeURIComponent(recordTypeQuery)}`
      );

      const contactQuery = `SELECT Id FROM Contact WHERE Account.RecordTypeId = '${recordType.records[0].Id}' AND Email = '${emailid}'`;
      const contactExists = await salesforceRequest(
        "GET",
        `query?q=${encodeURIComponent(contactQuery)}`
      );

      if (contactExists.totalSize > 0) {
        return res.status(400).json({ message: "Email already exists" });
      }

      // Create Contact
      // const domain = req.get("host");
      const activationLink = `http://${DOMAIN}/activate/${Buffer.from(
        emailid
      ).toString("base64")}/${generateActivationToken(emailid)}`;

      const data = await salesforceRequest("POST", "sobjects/Contact", {
        FirstName: firstname,
        LastName: lastname,
        Email: emailid,
        Phone: usernumber,
        Password__c: encryptVal(userpwd),
        Activate_Link__c: activationLink,
      });

      res.status(201).json({
        message: "Registration successful",
        success: true,
        data,
        activationLink,
      });
    } catch (error) {
      res.status(500).json({ message: "Registration failed", error });
    }
  }
);

app.get(
  "/activate/:uidb64/:token",
  ensureSalesforceAccessToken,
  async (req, res) => {
    const { uidb64, token } = req.params;
    const email = Buffer.from(uidb64, "base64").toString("utf-8");

    try {
      const contactQuery = `SELECT Id, Is_Email_Verify__c FROM Contact WHERE Email = '${email}'`;
      const contact = await salesforceRequest(
        "GET",
        `query?q=${encodeURIComponent(contactQuery)}`
      );

      if (contact.totalSize === 0 || contact.records[0].Is_Email_Verify__c) {
        return res.status(400).send("Invalid activation link");
      }

      await salesforceRequest(
        "PATCH",
        `sobjects/Contact/${contact.records[0].Id}`,
        {
          Is_Email_Verify__c: true,
        }
      );

      // res.redirect("/login");
      res.status(201).json({
        message: "Email activation successful",
        success: true,
      });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Activation failed", success: false, error: error });
    }
  }
);

app.post(
  "/api/auth/check-email",
  ensureSalesforceAccessToken,
  async (req, res) => {
    const { forgot_email } = req.body;
    try {
      const recordTypeQuery =
        "SELECT Id FROM RecordType WHERE Name = 'Household Account'";
      const recordType = await salesforceRequest(
        "GET",
        `query?q=${encodeURIComponent(recordTypeQuery)}`
      );

      const contactQuery = `SELECT Id, CHF_Account_Status__c, Is_Email_Verify__c FROM Contact WHERE Email = '${forgot_email}' AND Account.RecordTypeId = '${recordType.records[0].Id}'`;
      const contact = await salesforceRequest(
        "GET",
        `query?q=${encodeURIComponent(contactQuery)}`
      );

      if (contact.totalSize === 0) {
        return res.status(404).json({ message: "Email not registered" });
      }

      const contactRecord = contact.records[0];

      if (contactRecord.CHF_Account_Status__c === "Reject") {
        return res.status(403).json({ message: "User is locked" });
      }

      if (!contactRecord.Is_Email_Verify__c) {
        return res.status(403).json({ message: "Email not verified" });
      }

      // const domain = req.get("host");
      const resetPwdLink = `http://${DOMAIN}/reset-password/${Buffer.from(
        forgot_email
      ).toString("base64")}/${generateActivationToken(forgot_email)}`;

      await salesforceRequest("PATCH", `sobjects/Contact/${contactRecord.Id}`, {
        Reset_Pwd_Link__c: resetPwdLink,
      });

      res
        .status(200)
        .json({ message: "Password reset link sent", success: true });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Check email failed", error, success: false });
    }
  }
);

app.post(
  "/api/auth/reset-password",
  ensureSalesforceAccessToken,
  async (req, res) => {
    const { email, newPassword, confirmPassword } = req.body;

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    try {
      // const email = Buffer.from(uidb64, "base64").toString("utf-8");

      const contactQuery = `SELECT Id FROM Contact WHERE Email = '${email}'`;
      const contact = await salesforceRequest(
        "GET",
        `query?q=${encodeURIComponent(contactQuery)}`
      );

      if (contact.totalSize === 0) {
        return res.status(404).json({ message: "Invalid credentials" });
      }

      await salesforceRequest(
        "PATCH",
        `sobjects/Contact/${contact.records[0].Id}`,
        {
          // Password__c: newPassword,
          Password__c: encryptVal(newPassword),
        }
      );

      res
        .status(200)
        .json({ message: "Password reset successful", success: true });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Reset password failed", success: false, error });
    }
  }
);

app.post(
  "/api/auth/forgot-password",
  ensureSalesforceAccessToken,
  async (req, res) => {
    const { email, newPassword, confirmPassword } = req.body;

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    try {
      // const email = Buffer.from(uidb64, "base64").toString("utf-8");

      const contactQuery = `SELECT Id FROM Contact WHERE Email = '${email}'`;
      const contact = await salesforceRequest(
        "GET",
        `query?q=${encodeURIComponent(contactQuery)}`
      );

      if (contact.totalSize === 0) {
        return res.status(404).json({ message: "Invalid reset link" });
      }

      await salesforceRequest(
        "PATCH",
        `sobjects/Contact/${contact.records[0].Id}`,
        {
          Password__c: encryptVal(newPassword),
        }
      );

      res
        .status(200)
        .json({ message: "Password reset successful", success: true });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Reset password failed", error, success: false });
    }
  }
);

app.post(
  "/api/profile/update",
  ensureSalesforceAccessToken,
  async (req, res) => {
    const { firstName, lastName, mobile, Id } = req.body;

    try {
      const contactId = Id;

      await salesforceRequest("PATCH", `sobjects/Contact/${contactId}`, {
        FirstName: firstName,
        LastName: lastName,
        MobilePhone: mobile,
      });

      res.status(200).json({
        message: "Profile updated successfully",
        success: true,
        userData: { firstName, lastName, mobile },
      });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Profile update failed", error, success: false });
    }
  }
);

// 8. Member Info Update/Create
app.post(
  "/api/profile/add-member",
  ensureSalesforceAccessToken,
  async (req, res) => {
    const {
      // memHidId, // Member's hidden ID (used for updating existing members)
      relName, // Relationship of the member to the account (e.g., "Spouse", "Child")
      memFname, // Member's first name
      memLname, // Member's last name
      memEmailAddr, // Member's email address
      memMobile, // Member's mobile number
      memCreateAcc, // Flag indicating whether to create an account ("Yes"/"No")
      memDOB, // Member's date of birth
    } = req.body;

    try {
      // Get the RecordType ID for "Household Account"
      const recordTypeQuery = `SELECT Id FROM RecordType WHERE Name = 'Household Account'`;
      const recordType = await salesforceRequest(
        "GET",
        `query?q=${encodeURIComponent(recordTypeQuery)}`
      );

      // Check if a contact already exists with the provided email
      const contactQuery = `SELECT Id, Account.Id  FROM Contact WHERE Account.RecordTypeId = '${recordType.records[0].Id}' AND Email = '${memEmailAddr}'`;
      const contact = await salesforceRequest(
        "GET",
        `query?q=${encodeURIComponent(contactQuery)}`
      );
      const accountId = contact?.records[0]?.Account?.Id;
      const memHidId = contact?.records[0]?.Id;

      if (memHidId && !memCreateAcc) {
        // If member ID is provided, update the existing contact
        const updateData = {
          FirstName: memFname,
          LastName: memLname,
          MobilePhone: memMobile,
          Member_Relationship__c: relName,
          Member_Account__c: memCreateAcc, // Boolean conversion for account creation flag
          Birthdate: memDOB, // Format: YYYY-MM-DD
        };

        await salesforceRequest(
          "PATCH",
          `sobjects/Contact/${memHidId}`,
          updateData
        );
      } else if (contact.totalSize === 0 && memCreateAcc) {
        // If no member ID and email is not already in use, create a new contact
        const createData = {
          FirstName: memFname,
          LastName: memLname,
          Email: memEmailAddr,
          MobilePhone: memMobile,
          AccountId: accountId, // Associate the member with the provided account ID
          Member_Relationship__c: relName,
          Member_Account__c: memCreateAcc,
          Birthdate: memDOB,
        };

        await salesforceRequest("POST", "sobjects/Contact", createData);
      } else {
        // Email already exists in Salesforce
        return res
          .status(400)
          .json({ message: "Email does not exists.", success: false });
      }

      res.status(200).json({
        message: "Member info processed successfully.",
        success: true,
      });
    } catch (error) {
      res.status(500).json({
        message: "Error processing member info.",
        error,
        success: false,
      });
    }
  }
);

// 9. Delete Member
app.post(
  "/api/delete-member",
  ensureSalesforceAccessToken,
  async (req, res) => {
    const {
      memberId, // ID of the member to be deleted
      contactId, // ID of the account associated with the member
    } = req.body;

    const query = `SELECT ID, ACCOUNT.ID FROM Contact WHERE Id = '${contactId}'`;
    const contactData = await salesforceRequest(
      "GET",
      `query?q=${encodeURIComponent(query)}`
    );

    try {
      // Update the member's status to "Reject" and clear their email
      await salesforceRequest("PATCH", `sobjects/Contact/${memberId}`, {
        CHF_Account_Status__c: "Reject", // Mark the member as rejected
        Email: "", // Remove email from the member record
      });

      // Fetch the list of remaining approved members for the account
      const memberQuery = `SELECT Id, FirstName, LastName FROM Contact WHERE AccountId = '${contactData?.records[0]?.Account?.Id}' AND CHF_Account_Status__c = 'Approve'`;
      const updatedMembers = await salesforceRequest(
        "GET",
        `query?q=${encodeURIComponent(memberQuery)}`
      );

      res.status(200).json({
        message: "Member deleted successfully.",
        members: updatedMembers.records, // Return the updated list of members
        success: true,
      });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Error deleting member.", error, success: false });
    }
  }
);

app.post("/api/auth/login", ensureSalesforceAccessToken, async (req, res) => {
  const { email, password } = req.body;
  console.log(email, password);

  try {
    // Validate reCAPTCHA
    // const recaptchaResponse = false;

    // if (!recaptchaResponse.data.success) {
    //   return res.status(400).json({ message: "reCAPTCHA verification failed" });
    // }
    //const recaptchaResponse = false;

    //    if (!recaptchaResponse.data.success) {
    //    return res.status(400).json({ message: "reCAPTCHA verification failed" });
    // }

    // Query Contact
    const contactQuery = `SELECT Id, Password__c, Is_Email_Verify__c, CHF_Account_Status__c FROM Contact WHERE Email = '${email}'`;
    const contact = await salesforceRequest(
      "GET",
      `query?q=${encodeURIComponent(contactQuery)}`
    );

    if (contact.totalSize === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const contactRecord = contact.records[0];

    if (
      contactRecord.CHF_Account_Status__c !== "Approve" ||
      !contactRecord.Is_Email_Verify__c
    ) {
      return res
        .status(403)
        .json({ message: "Account not verified or approved" });
    }

    const decryptedPassword = decryptVal(contactRecord.Password__c);
    //    const decryptedPassword = decryptVal(contactRecord.Password__c);
    // console.log("decryptedPassword", decryptedPassword);

    if (decryptedPassword !== password) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    res.status(200).json({
      message: "Login successful",
      data: { userId: contactRecord.Id, email },
    });
  } catch (error) {
    res.status(500).json({ message: "Login failed", error });
  }
});

// ========== STRIPE CODE (UNCHANGED) ==========
const stripe = require("stripe")(`${process.env.VITE_STRIPE_CLIENT_SECRET}`);

console.log("VITE_STRIPE_CLIENT_SECRET", process.env.VITE_STRIPE_CLIENT_SECRET);

const calculateOrderAmount = (items) => {
  let total = 0;
  items.forEach((item) => {
    total += item.amount;
  });
  return total;
};

app.post("/create-payment-intent", async (req, res) => {
  const { items } = req.body;
  console.log("🚀 ~ app.post ~ items:", items);

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: calculateOrderAmount(items),
      currency: "usd",
      automatic_payment_methods: { enabled: true },
    });

    // Return client secret only
    res.status(200).send({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    res.status(500).send(error);
  }
});
// ========== END STRIPE CODE ==========

// ========== SALESFORCE ROUTES (with ensureSalesforceAccessToken) ==========

// 1. Contact Query
app.get("/api/contact", ensureSalesforceAccessToken, async (req, res) => {
  try {
    const email = req.query.email;
    const query = `SELECT ID, EMAIL, FIRSTNAME, LASTNAME, MOBILEPHONE, ACCOUNT.ID FROM Contact WHERE Email = '${email}'`;
    const data = await salesforceRequest(
      "GET",
      `query?q=${encodeURIComponent(query)}`
    );
    console.log("data", data?.records[0]?.Account);
    const query1 = `SELECT ID, BILLINGSTREET, BILLINGCITY, BILLINGSTATE, BILLINGCOUNTRY, BILLINGPOSTALCODE, SHIPPINGSTREET,SHIPPINGCITY,SHIPPINGCOUNTRY, SHIPPINGSTATE, SHIPPINGPOSTALCODE FROM Account WHERE Id = '${data?.records[0]?.Account?.Id}'`;
    const data1 = await salesforceRequest(
      "GET",
      `query?q=${encodeURIComponent(query1)}`
    );

    res.json({
      firstName: data?.records[0]?.FirstName,
      lastName: data?.records[0]?.LastName,
      email: data?.records[0]?.Email,
      mobile: data?.records[0]?.MobilePhone,
      billingStreet: data1?.records[0]?.BillingStreet,
      billingCity: data1?.records[0]?.BillingCity,
      billingState: data1?.records[0]?.BillingState,
      billingCountry: data1?.records[0]?.BillingCountry,
      billingPostalCode: data1?.records[0]?.BillingPostalCode,
      shippingStreet: data1?.records[0]?.ShippingStreet,
      shippingCity: data1?.records[0]?.ShippingCity,
      shippingCountry: data1?.records[0]?.ShippingCountry,
      shippingState: data1?.records[0]?.ShippingState,
      shippingPostalCode: data1?.records[0]?.ShippingPostalCode,
    });
  } catch (error) {
    res.status(500).json(error);
  }
});

app.get("/", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.json({ user: "admin" });
});

// 2. Contact Create
app.post("/api/contact", ensureSalesforceAccessToken, async (req, res) => {
  try {
    const data = await salesforceRequest("POST", "sobjects/Contact", req.body);
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json(error);
  }
});

// 3. Account Update
app.patch(
  "/api/profile/address",
  ensureSalesforceAccessToken,
  async (req, res) => {
    const { contactId } = req.body;
    try {
      // const accountId = req.params.id;
      const query = `SELECT ID, ACCOUNT.ID FROM Contact WHERE Id = '${contactId}'`;
      const contactData = await salesforceRequest(
        "GET",
        `query?q=${encodeURIComponent(query)}`
      );
      const data = await salesforceRequest(
        "PATCH",
        `sobjects/Account/${contactData?.records[0]?.Account?.Id}`,
        {
          BillingCity: req.body.billingCity,
          BillingCountry: req.body.billingCountry,
          BillingPostalCode: req.body.billingPostalCode,
          BillingState: req.body.billingState,
          BillingStreet: req.body.billingStreet,
          ShippingCity: req.body.shippingCity,
          ShippingCountry: req.body.shippingCountry,
          ShippingPostalCode: req.body.shippingPostalCode,
          ShippingState: req.body.shippingState,
          ShippingStreet: req.body.shippingStreet,
        }
      );
      res.status(200).json({
        message: "Address updated successfully",
        success: true,
        data,
      });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Address update failed. Please try again.", error });
    }
  }
);

// 4. Opportunity Create
app.post("/api/opportunity", ensureSalesforceAccessToken, async (req, res) => {
  try {
    const data = await salesforceRequest(
      "POST",
      "sobjects/Opportunity",
      req.body
    );
    res.status(201).json({data, success: true});
  } catch (error) {
    res.status(500).json(error);
  }
});

// 5. Opportunity Update
app.patch(
  "/api/opportunity/:id",
  ensureSalesforceAccessToken,
  async (req, res) => {
    try {
      const opportunityId = req.params.id;
      const data = await salesforceRequest(
        "PATCH",
        `sobjects/Opportunity/${opportunityId}`,
        req.body
      );
      res.json(data);
    } catch (error) {
      res.status(500).json(error);
    }
  }
);

// 6. DonationSummary Create
app.post(
  "/api/donationsummary",
  ensureSalesforceAccessToken,
  async (req, res) => {
    try {
      const data = await salesforceRequest(
        "POST",
        "sobjects/DonationSummary__c",
        req.body
      );
      res.status(201).json(data);
    } catch (error) {
      res.status(500).json(error);
    }
  }
);

// 7. Internal API for refreshing access token (optional)
app.post("/internal/refresh-token", async (req, res) => {
  try {
    await refreshAccessToken();
    res.status(200).json({ message: "Access token refreshed successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to refresh access token", error });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
