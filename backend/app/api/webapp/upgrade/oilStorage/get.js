const { Router } = require("express");
const ApiError = require("../../../../exceptions/api-error");
const authMiddleware = require("../../../../middlewares/authMiddleware");

// get current derrick level
module.exports = Router({ mergeParams: true }).get("/upgrade/oilStorage", authMiddleware, async (req, res, next) => {
	try {
		const { db } = req;
		const tgId = req.user.id;
		let userModel = db.User;

		let user = await userModel.findOne({ tgId });

		if (!user) {
			throw res.status(404).json("User not found");
		}

		res.json({ oilStorageLevel: user.oilStorageLevel });
	} catch (error) {
		console.error("Error while buying a derrick:", error);
		next(error);
	}
});
