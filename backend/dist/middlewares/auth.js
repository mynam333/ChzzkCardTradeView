"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const repositories_1 = require("../repositories");
const JWT_SECRET = process.env.JWT_SECRET || 'chzzk_secret_key_2026';
/**
 * 사용자 JWT 토큰 검증 및 req.user 할당 미들웨어
 */
const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: '인증 헤더(Authorization)가 제공되지 않았습니다.'
        });
    }
    const [type, token] = authHeader.split(' ');
    // 오직 표준 Bearer JWT 검증만 수행
    if (type !== 'Bearer' || !token) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: '유효한 Bearer 토큰 형식이 아닙니다.'
        });
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        const user = await repositories_1.userRepository.findById(decoded.id);
        if (!user) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: '해당 토큰의 사용자를 조회할 수 없습니다.'
            });
        }
        req.user = user;
        next();
    }
    catch (err) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: '만료되었거나 손상된 토큰입니다.',
            details: err.message
        });
    }
};
exports.authMiddleware = authMiddleware;
