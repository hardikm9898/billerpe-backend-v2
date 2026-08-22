const path = require("path");
const multer = require("multer");
const multerS3 = require("multer-s3");
const { S3Client } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const { error } = require("console");
const { STATUSCODE } = require("../constant/const");
// Automatically uses IAM Role credentials — no keys required!
const s3Client = new S3Client({
    region: "ap-south-1",
});

const upload = multer({
    storage: multerS3({
        s3: s3Client,
        acl: "public-read",
        bucket: "bpe-upload-data",
        contentType: multerS3.AUTO_CONTENT_TYPE,
        metadata: (req, file, cb) => {
            cb(null, { fieldName: file.fieldname });
        },
        key: (req, file, cb) => {
            const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
            const fileExt = path.extname(file.originalname);
            cb(null, `uploads/${uniqueSuffix}${fileExt}`);
        },
    }),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = ["image/jpeg", "image/jpg", "image/png", "video/mp4"];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Only image and MP4 video files are allowed!"), false);
        }
    },
});

const uploadSingleTest = (fieldName) => {
    return (req, res, next) => {
        upload.single(fieldName)(req, res, (err) => {
            if (err) {
                if (err instanceof multer.MulterError) {
                    return next(err);
                } else if (err instanceof Error) {
                    return next(err);
                }
            }

            if (!req.file) {
                return next("No file uploaded!");
            }

            req.fileUrl = req.file.location
            next()

        });
    };
};
const uploadWhatsAppTemplateImage = (fieldName) => {
    return (req, res, next) => {
        upload.single(fieldName)(req, res, (err) => {
            if (err) {
                if (err instanceof multer.MulterError) {
                    return next(err);
                } else if (err instanceof Error) {
                    return next(err);
                }
            }


            next()

        });
    };
};
const uploadSingleAttachedment = (fieldName) => {
    return (req, res, next) => {
        upload.single(fieldName)(req, res, (err) => {
            if (err) {
                if (err instanceof multer.MulterError) {
                    // return res.json(error(err.message, STATUSCODE.BAD_REQUEST))
                    return next(err);
                } else if (err instanceof Error) {
                    // return res.json(error(err.message, STATUSCODE.BAD_REQUEST))
                    return next(err);
                }
            }
            if (!req.file) {
                // return res.json(error("File Not Upload", STATUSCODE.BAD_REQUEST))
                return next("No file uploaded!");
            }
            next()

        });
    };
};


const uploadMultipleTest = (fieldName) => {
    return async (req, res, next) => {
        try {
            await new Promise((resolve, reject) => {
                upload.array(fieldName, 3)(req, res, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            req.fileList = req.files || []; // Always set fileList
            next(); // Continue regardless of upload status
        } catch (error) {
            console.error("Upload error:", error);
            res.status(500).json({ success: false, message: error.message });
        }
    };
};


module.exports = { uploadWhatsAppTemplateImage, uploadSingleAttachedment, uploadMultipleTest, uploadSingleTest }