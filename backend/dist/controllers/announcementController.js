"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteAnnouncement = exports.getActivePopups = exports.getAnnouncements = exports.createAnnouncement = void 0;
const repositories_1 = require("../repositories");
/**
 * 1. 공지사항 및 팝업 작성 (ADMIN 전용)
 */
const createAnnouncement = async (req, res) => {
    const { title, content, is_popup, popup_expires_at } = req.body;
    if (!title || !content) {
        return res.status(400).json({ error: 'BadRequest', message: '공지사항 제목과 내용이 필요합니다.' });
    }
    try {
        const announcement = await repositories_1.announcementRepository.create({
            title,
            content,
            is_popup: !!is_popup,
            popup_expires_at: popup_expires_at || null
        });
        return res.status(201).json(announcement);
    }
    catch (err) {
        return res.status(500).json({ error: 'InternalServerError', message: '공지사항 생성 실패', details: err.message });
    }
};
exports.createAnnouncement = createAnnouncement;
/**
 * 2. 공지사항 전체 목록 조회
 */
const getAnnouncements = async (req, res) => {
    try {
        const list = await repositories_1.announcementRepository.findAll();
        return res.status(200).json(list);
    }
    catch (err) {
        return res.status(500).json({ error: 'InternalServerError', message: '공지사항 목록 조회 실패', details: err.message });
    }
};
exports.getAnnouncements = getAnnouncements;
/**
 * 3. 활성화된 팝업 공지 목록 조회
 */
const getActivePopups = async (req, res) => {
    try {
        const popups = await repositories_1.announcementRepository.findActivePopups();
        return res.status(200).json(popups);
    }
    catch (err) {
        return res.status(500).json({ error: 'InternalServerError', message: '활성 팝업 조회 실패', details: err.message });
    }
};
exports.getActivePopups = getActivePopups;
/**
 * 4. 공지사항 삭제 (ADMIN 전용)
 */
const deleteAnnouncement = async (req, res) => {
    const { id } = req.params;
    if (!id) {
        return res.status(400).json({ error: 'BadRequest', message: '공지사항 ID가 필요합니다.' });
    }
    try {
        await repositories_1.announcementRepository.delete(Number(id));
        return res.status(200).json({ message: '공지사항이 성공적으로 삭제되었습니다.', id: Number(id) });
    }
    catch (err) {
        return res.status(500).json({ error: 'InternalServerError', message: '공지사항 삭제 실패', details: err.message });
    }
};
exports.deleteAnnouncement = deleteAnnouncement;
