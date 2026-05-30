"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initRepositories = exports.announcementRepository = exports.reportRepository = exports.couponRepository = exports.streamerRepository = exports.userRepository = void 0;
const db_1 = require("../services/db");
const sqliteRepository_1 = require("./sqliteRepository");
const supabaseRepository_1 = require("./supabaseRepository");
/**
 * 데이터베이스 커넥션이 확립된 후, 모드에 적합한 레포지토리 인스턴스를 초기화합니다.
 */
const initRepositories = () => {
    const mode = (0, db_1.getDbMode)();
    if (mode === 'SUPABASE') {
        exports.userRepository = new supabaseRepository_1.SupabaseUserRepository();
        exports.streamerRepository = new supabaseRepository_1.SupabaseStreamerRepository();
        exports.couponRepository = new supabaseRepository_1.SupabaseCouponRepository();
        exports.reportRepository = new supabaseRepository_1.SupabaseReportRepository();
        exports.announcementRepository = new supabaseRepository_1.SupabaseAnnouncementRepository();
        console.log('[Repository] Supabase 리포지토리 레이어가 활성화되었습니다.');
    }
    else {
        exports.userRepository = new sqliteRepository_1.SqliteUserRepository();
        exports.streamerRepository = new sqliteRepository_1.SqliteStreamerRepository();
        exports.couponRepository = new sqliteRepository_1.SqliteCouponRepository();
        exports.reportRepository = new sqliteRepository_1.SqliteReportRepository();
        exports.announcementRepository = new sqliteRepository_1.SqliteAnnouncementRepository();
        console.log('[Repository] 로컬 SQLite 리포지토리 레이어가 활성화되었습니다.');
    }
};
exports.initRepositories = initRepositories;
__exportStar(require("./interfaces"), exports);
__exportStar(require("./sqliteRepository"), exports);
__exportStar(require("./supabaseRepository"), exports);
