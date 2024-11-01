const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { uploadAvatarWithUrl } = require("./uploadAvatar");
const Bottleneck = require("bottleneck");
const limiter = new Bottleneck({
	minTime: 1000 / 2, // 2 requests per second
	maxConcurrent: 1,
});

const generateToken = (initData) => {
	const expiresIn = process.env.JWT_EXPIRES_IN || "1h";
	const token = jwt.sign(initData, process.env.JWT_SECRET, { expiresIn });
	const expiresInUnix = Math.floor(Date.now() / 1000) + parseDurationToSeconds(expiresIn);
	return { token, expiresIn: expiresInUnix };
};

// Helper function to parse duration strings like "1h", "2d", etc. to seconds
const parseDurationToSeconds = (duration) => {
	const regex = /(\d+)([smhd])/;
	const match = regex.exec(duration);

	if (!match) return 3600; // Default to 1 hour if the format is invalid

	const value = parseInt(match[1]);
	const unit = match[2];

	switch (unit) {
		case "s":
			return value;
		case "m":
			return value * 60;
		case "h":
			return value * 60 * 60;
		case "d":
			return value * 60 * 60 * 24;
		default:
			return 3600;
	}
};

const verifyInitData = (initData) => {
	const urlParams = new URLSearchParams(initData);

	const hash = urlParams.get("hash");
	urlParams.delete("hash");
	urlParams.sort();

	let dataCheckString = "";
	for (const [key, value] of urlParams.entries()) {
		dataCheckString += `${key}=${value}\n`;
	}
	dataCheckString = dataCheckString.slice(0, -1);

	const secret = crypto.createHmac("sha256", "WebAppData").update(process.env.BOT_TOKEN ?? "");
	const calculatedHash = crypto.createHmac("sha256", secret.digest()).update(dataCheckString).digest("hex");

	return calculatedHash === hash;
};

function urlSearchParamsToObject(urlSearchParamsString) {
	const urlSearchParams = new URLSearchParams(urlSearchParamsString);

	const paramsObject = {};
	urlSearchParams.forEach((value, key) => {
		if (paramsObject[key]) {
			if (Array.isArray(paramsObject[key])) {
				paramsObject[key].push(value);
			} else {
				paramsObject[key] = [paramsObject[key], value];
			}
		} else {
			paramsObject[key] = value;
		}
	});

	return paramsObject;
}

const register = async (db, tgBot, EnterReferralCode, tgUser) => {
	const tgId = tgUser.id;
	let user = await db.User.findOne({ tgId });
	if (!user) {
		// get telegram avatar
		let userTgAvatar = "";
		const userProfilePhotos = await tgBot.getUserProfilePhotos(tgId);
		if (userProfilePhotos.total_count > 0) {
			// Get the first photo's file_id
			const fileId = userProfilePhotos.photos[0][0].file_id;
			const file = await tgBot.getFile(fileId);

			// Construct the URL for the file
			let url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;

			// download and upload avatar
			let uploadResponse = await uploadAvatarWithUrl(url, { tgId });
			console.log(uploadResponse);
			if (uploadResponse.error == false) {
				userTgAvatar = uploadResponse.fileName;
			}
		}

		const referralCode = generateReferralCode();
		user = await db.User.create({
			tgId,
			referralCode,
			EnterReferralCode: EnterReferralCode,
			nickName: tgUser.first_name,
			tgUsername: tgUser.username,
			avatarUrl: userTgAvatar,
			createdAt: new Date(),
		});

		let referrer = await db.User.findOne({
			referralCode: EnterReferralCode,
		});

		if (referrer) {
			const settings = await db.Settings.findOne({});

			// give reward to user that used referral code
			user = await db.User.findOneAndUpdate(
				{ tgId },
				{
					$inc: { balance: settings.referralReward ? settings.referralReward : 0 },
				},
				{ new: true }
			);

			// give reward to referrer that invited user
			referrer = await db.User.findOneAndUpdate(
				{ referralCode: EnterReferralCode },
				{
					referralCode: EnterReferralCode,
					$inc: { balance: settings.referrerReward ? settings.referrerReward : 0 },
				},
				{ new: true }
			);

			// send message when somebody joined referral

			await limiter.schedule(() =>
				tgBot.sendMessage(
					referrer.tgId,
					`Congratulations🥳\nYour friend ${tgUser.username ? `@${tgUser.username}` : tgUser.first_name} has successfully joined!`
				)
			);
		}
	}
	return user;
};

const generateReferralCode = () => {
	const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	const codeLength = 8;
	let code = "";

	for (let i = 0; i < codeLength; i++) {
		const randomIndex = Math.floor(Math.random() * characters.length);
		code += characters.charAt(randomIndex);
	}

	return code;
};

module.exports = { generateToken, verifyInitData, urlSearchParamsToObject, register };
