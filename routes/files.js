import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import db from '../config/db.js';
import { authenticateToken } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const userDir = path.join(uploadsDir, req.user.id.toString());
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }
        cb(null, userDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 // 10MB default
    },
    fileFilter: (req, file, cb) => {
        // You can add file type restrictions here if needed
        cb(null, true);
    }
});

// Upload files
router.post('/upload', authenticateToken, upload.array('files', 10), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        const uploadedFiles = [];
        const stmt = db.prepare('INSERT INTO files (user_id, filename, original_name, size, mimetype) VALUES (?, ?, ?, ?, ?)');

        for (const file of req.files) {
            const result = stmt.run(
                req.user.id,
                file.filename,
                file.originalname,
                file.size,
                file.mimetype
            );

            uploadedFiles.push({
                id: result.lastInsertRowid,
                filename: file.filename,
                originalName: file.originalname,
                size: file.size,
                mimetype: file.mimetype
            });
        }

        res.status(201).json({
            message: 'Files uploaded successfully',
            files: uploadedFiles
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Failed to upload files' });
    }
});

// Get user's files
router.get('/', authenticateToken, (req, res) => {
    try {
        const files = db.prepare('SELECT id, filename, original_name, size, mimetype, upload_date FROM files WHERE user_id = ? ORDER BY upload_date DESC').all(req.user.id);
        res.json(files);
    } catch (error) {
        console.error('Get files error:', error);
        res.status(500).json({ error: 'Failed to retrieve files' });
    }
});

// Download file
router.get('/download/:id', authenticateToken, (req, res) => {
    try {
        const fileId = req.params.id;
        const file = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?').get(fileId, req.user.id);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        const filePath = path.join(uploadsDir, req.user.id.toString(), file.filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on server' });
        }

        res.download(filePath, file.original_name);
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ error: 'Failed to download file' });
    }
});

// Delete file
router.delete('/:id', authenticateToken, (req, res) => {
    try {
        const fileId = req.params.id;
        const file = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?').get(fileId, req.user.id);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        const filePath = path.join(uploadsDir, req.user.id.toString(), file.filename);

        // Delete from filesystem
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        // Delete from database
        db.prepare('DELETE FROM files WHERE id = ?').run(fileId);

        res.json({ message: 'File deleted successfully' });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

// Rename file
router.put('/rename/:id', authenticateToken, (req, res) => {
    try {
        const fileId = req.params.id;
        const { newName } = req.body;

        if (!newName) {
            return res.status(400).json({ error: 'New name is required' });
        }

        const file = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?').get(fileId, req.user.id);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Update database
        db.prepare('UPDATE files SET original_name = ? WHERE id = ?').run(newName, fileId);

        res.json({ message: 'File renamed successfully', newName });
    } catch (error) {
        console.error('Rename error:', error);
        res.status(500).json({ error: 'Failed to rename file' });
    }
});

export default router;
