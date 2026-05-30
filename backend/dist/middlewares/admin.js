"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminMiddleware = void 0;
/**
 * 어드민(ADMIN) 권한 소유 여부를 검증하는 미들웨어
 */
const adminMiddleware = (req, res, next) => {
    const user = req.user;
    if (!user) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: '인증 헤더가 누락되었거나 식별된 유저가 없습니다.'
        });
    }
    // 관리자 권한 확인
    if (user.role !== 'ADMIN') {
        return res.status(403).json({
            error: 'Forbidden',
            message: '해당 권한으로는 이 요청을 수행할 수 없습니다. (관리자 전용)'
        });
    }
    next();
};
exports.adminMiddleware = adminMiddleware;
