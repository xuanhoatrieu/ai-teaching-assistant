import React, { useState, useRef, useEffect, useCallback } from 'react';

interface ImageCropModalProps {
    isOpen: boolean;
    imageSrc: string;
    slideIndex: number;
    onClose: () => void;
    onCropComplete: (croppedBlob: Blob) => Promise<void> | void;
    isUploading?: boolean;
}

const CONTAINER_SIZE = 320;

export const ImageCropModal: React.FC<ImageCropModalProps> = ({
    isOpen,
    imageSrc,
    slideIndex,
    onClose,
    onCropComplete,
    isUploading = false,
}) => {
    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [imageLoaded, setImageLoaded] = useState(false);
    const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
    const [bgColor, setBgColor] = useState<'#ffffff' | '#0f172a' | '#f8fafc'>('#ffffff');

    const imageRef = useRef<HTMLImageElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    // Reset crop state whenever modal opens or imageSrc changes
    useEffect(() => {
        if (isOpen) {
            setZoom(1);
            setOffset({ x: 0, y: 0 });
            setImageLoaded(false);
            setNaturalSize({ width: 0, height: 0 });
        }
    }, [isOpen, imageSrc]);

    const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const img = e.currentTarget;
        const nw = img.naturalWidth || CONTAINER_SIZE;
        const nh = img.naturalHeight || CONTAINER_SIZE;
        setNaturalSize({ width: nw, height: nh });
        setImageLoaded(true);
        setZoom(1);
        setOffset({ x: 0, y: 0 });
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsDragging(true);
        setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
    };

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isDragging) return;
        setOffset({
            x: e.clientX - dragStart.x,
            y: e.clientY - dragStart.y,
        });
    }, [isDragging, dragStart]);

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        } else {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, handleMouseMove, handleMouseUp]);

    // Handle mouse wheel zoom (from 0.1x to 4.0x)
    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY * -0.001;
        setZoom(prev => Math.min(Math.max(prev + delta, 0.1), 4));
    };

    // Calculate base dimensions fitting the 320x320 container
    const fitScale = naturalSize.width && naturalSize.height
        ? CONTAINER_SIZE / Math.max(naturalSize.width, naturalSize.height)
        : 1;

    const baseWidth = naturalSize.width ? naturalSize.width * fitScale : CONTAINER_SIZE;
    const baseHeight = naturalSize.height ? naturalSize.height * fitScale : CONTAINER_SIZE;

    const renderedWidth = baseWidth * zoom;
    const renderedHeight = baseHeight * zoom;

    // Quick Fit: fits entire image inside the square (no part cut off)
    const handleFit = () => {
        setZoom(1);
        setOffset({ x: 0, y: 0 });
    };

    // Quick Cover: zooms so smaller dimension covers the square (fills entire frame)
    const handleCover = () => {
        if (!naturalSize.width || !naturalSize.height) return;
        const coverScale = CONTAINER_SIZE / Math.min(naturalSize.width, naturalSize.height);
        const coverZoom = coverScale / fitScale;
        setZoom(coverZoom);
        setOffset({ x: 0, y: 0 });
    };

    const handleReset = () => {
        setZoom(1);
        setOffset({ x: 0, y: 0 });
    };

    const handleApply = () => {
        if (!imageRef.current || !containerRef.current) return;

        const img = imageRef.current;
        const container = containerRef.current;
        const containerRect = container.getBoundingClientRect();
        const imgRect = img.getBoundingClientRect();

        // Target output resolution: 1024x1024 (Exact standard for AI slide images)
        const targetSize = 1024;
        const canvas = document.createElement('canvas');
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Fill background with chosen color (default #ffffff white)
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, targetSize, targetSize);

        // Exact geometric mapping ratio from 320px viewport to 1024px canvas
        const ratio = targetSize / containerRect.width;

        const destX = (imgRect.left - containerRect.left) * ratio;
        const destY = (imgRect.top - containerRect.top) * ratio;
        const destWidth = imgRect.width * ratio;
        const destHeight = imgRect.height * ratio;

        // Draw the image onto the canvas at exact destination coordinates
        ctx.drawImage(
            img,
            destX,
            destY,
            destWidth,
            destHeight
        );

        canvas.toBlob(
            (blob) => {
                if (blob) {
                    onCropComplete(blob);
                }
            },
            'image/png',
            0.95
        );
    };

    if (!isOpen) return null;

    return (
        <div className="crop-modal-overlay" style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
        }}>
            <div className="crop-modal-card" style={{
                background: '#ffffff',
                borderRadius: '16px',
                width: '100%',
                maxWidth: '540px',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
            }}>
                {/* Header */}
                <div style={{
                    padding: '16px 20px',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#0f172a', fontWeight: 600 }}>
                            ✂️ Căn chỉnh & Tự động Resize ảnh (Slide {slideIndex})
                        </h3>
                        <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                            Tỉ lệ chuẩn 1:1 • Tự động xuất ảnh 1024×1024 px thay thế ảnh AI
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={isUploading}
                        style={{
                            border: 'none',
                            background: 'transparent',
                            fontSize: '1.25rem',
                            cursor: 'pointer',
                            color: '#64748b',
                            padding: '4px 8px',
                            borderRadius: '6px',
                        }}
                    >
                        ✕
                    </button>
                </div>

                {/* Body / Viewport */}
                <div style={{
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    backgroundColor: '#f8fafc',
                }}>
                    {/* 1:1 Square Viewport */}
                    <div
                        ref={containerRef}
                        onWheel={handleWheel}
                        onMouseDown={handleMouseDown}
                        style={{
                            width: `${CONTAINER_SIZE}px`,
                            height: `${CONTAINER_SIZE}px`,
                            position: 'relative',
                            overflow: 'hidden',
                            borderRadius: '12px',
                            boxShadow: '0 0 0 3px #6366f1, 0 10px 25px -5px rgba(0,0,0,0.3)',
                            cursor: isDragging ? 'grabbing' : 'grab',
                            backgroundColor: bgColor,
                            userSelect: 'none',
                        }}
                    >
                        <img
                            ref={imageRef}
                            src={imageSrc}
                            alt="Crop target"
                            onLoad={handleImageLoad}
                            draggable={false}
                            style={{
                                position: 'absolute',
                                left: '50%',
                                top: '50%',
                                width: `${renderedWidth}px`,
                                height: `${renderedHeight}px`,
                                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                                transformOrigin: 'center center',
                                pointerEvents: 'none',
                                transition: isDragging ? 'none' : 'width 0.05s ease-out, height 0.05s ease-out, transform 0.05s ease-out',
                                objectFit: 'contain',
                            }}
                        />

                        {/* Grid overlay for 1:1 composition guidelines */}
                        <div style={{
                            position: 'absolute',
                            inset: 0,
                            pointerEvents: 'none',
                            border: '1px solid rgba(255, 255, 255, 0.4)',
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr 1fr',
                            gridTemplateRows: '1fr 1fr 1fr',
                        }}>
                            <div style={{ borderRight: '1px dashed rgba(99, 102, 241, 0.3)', borderBottom: '1px dashed rgba(99, 102, 241, 0.3)' }}></div>
                            <div style={{ borderRight: '1px dashed rgba(99, 102, 241, 0.3)', borderBottom: '1px dashed rgba(99, 102, 241, 0.3)' }}></div>
                            <div style={{ borderBottom: '1px dashed rgba(99, 102, 241, 0.3)' }}></div>
                            <div style={{ borderRight: '1px dashed rgba(99, 102, 241, 0.3)', borderBottom: '1px dashed rgba(99, 102, 241, 0.3)' }}></div>
                            <div style={{ borderRight: '1px dashed rgba(99, 102, 241, 0.3)', borderBottom: '1px dashed rgba(99, 102, 241, 0.3)' }}></div>
                            <div style={{ borderBottom: '1px dashed rgba(99, 102, 241, 0.3)' }}></div>
                            <div style={{ borderRight: '1px dashed rgba(99, 102, 241, 0.3)' }}></div>
                            <div style={{ borderRight: '1px dashed rgba(99, 102, 241, 0.3)' }}></div>
                            <div></div>
                        </div>

                        {/* Drag instruction overlay */}
                        <div style={{
                            position: 'absolute',
                            bottom: '8px',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            backgroundColor: 'rgba(0, 0, 0, 0.65)',
                            color: '#ffffff',
                            padding: '3px 10px',
                            borderRadius: '12px',
                            fontSize: '0.75rem',
                            pointerEvents: 'none',
                            whiteSpace: 'nowrap',
                        }}>
                            🖐️ Kéo ảnh để di chuyển vị trí
                        </div>
                    </div>

                    {/* Quick Alignment & Sizing Buttons */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        marginTop: '14px',
                        width: '320px',
                    }}>
                        <button
                            type="button"
                            onClick={handleFit}
                            title="Thu nhỏ vừa vặn toàn bộ hình ảnh vào khung 1:1"
                            style={{
                                flex: 1,
                                padding: '6px 8px',
                                fontSize: '0.75rem',
                                borderRadius: '6px',
                                border: '1px solid #cbd5e1',
                                background: '#ffffff',
                                cursor: 'pointer',
                                color: '#334155',
                                fontWeight: 500,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '4px',
                            }}
                        >
                            📐 Vừa khung (100%)
                        </button>
                        <button
                            type="button"
                            onClick={handleCover}
                            title="Phóng to để hình lấp đầy toàn bộ khung 1:1 (không có viền)"
                            style={{
                                flex: 1,
                                padding: '6px 8px',
                                fontSize: '0.75rem',
                                borderRadius: '6px',
                                border: '1px solid #cbd5e1',
                                background: '#ffffff',
                                cursor: 'pointer',
                                color: '#334155',
                                fontWeight: 500,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '4px',
                            }}
                        >
                            🔍 Lấp đầy khung
                        </button>
                        <button
                            type="button"
                            onClick={handleReset}
                            title="Đặt lại vị trí giữa và tỉ lệ chuẩn"
                            style={{
                                padding: '6px 10px',
                                fontSize: '0.75rem',
                                borderRadius: '6px',
                                border: '1px solid #cbd5e1',
                                background: '#ffffff',
                                cursor: 'pointer',
                                color: '#334155',
                                fontWeight: 500,
                            }}
                        >
                            ↺ Đặt lại
                        </button>
                    </div>

                    {/* Controls: Zoom slider */}
                    <div style={{
                        marginTop: '10px',
                        width: '320px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                    }}>
                        <span style={{ fontSize: '0.85rem', color: '#475569', fontWeight: 500 }}>🔍</span>
                        <input
                            type="range"
                            min="0.1"
                            max="3.0"
                            step="0.01"
                            value={zoom}
                            onChange={(e) => setZoom(parseFloat(e.target.value))}
                            style={{ flex: 1, cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: '0.85rem', color: '#475569', minWidth: '45px', textAlign: 'right' }}>
                            {Math.round(zoom * 100)}%
                        </span>
                    </div>

                    {/* Background Color Options for Margin Area */}
                    <div style={{
                        marginTop: '12px',
                        width: '320px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        background: '#ffffff',
                        borderRadius: '8px',
                        border: '1px solid #e2e8f0',
                        fontSize: '0.78rem',
                        color: '#475569',
                    }}>
                        <span>Màu viền thừa:</span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                                type="button"
                                onClick={() => setBgColor('#ffffff')}
                                style={{
                                    border: bgColor === '#ffffff' ? '2px solid #6366f1' : '1px solid #cbd5e1',
                                    background: '#ffffff',
                                    color: '#0f172a',
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontWeight: bgColor === '#ffffff' ? 600 : 400,
                                    fontSize: '0.75rem',
                                }}
                            >
                                ⚪ Trắng
                            </button>
                            <button
                                type="button"
                                onClick={() => setBgColor('#0f172a')}
                                style={{
                                    border: bgColor === '#0f172a' ? '2px solid #6366f1' : '1px solid #cbd5e1',
                                    background: '#0f172a',
                                    color: '#ffffff',
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontWeight: bgColor === '#0f172a' ? 600 : 400,
                                    fontSize: '0.75rem',
                                }}
                            >
                                ⚫ Tối
                            </button>
                            <button
                                type="button"
                                onClick={() => setBgColor('#f8fafc')}
                                style={{
                                    border: bgColor === '#f8fafc' ? '2px solid #6366f1' : '1px solid #cbd5e1',
                                    background: '#f8fafc',
                                    color: '#334155',
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontWeight: bgColor === '#f8fafc' ? 600 : 400,
                                    fontSize: '0.75rem',
                                }}
                            >
                                🌫️ Xám nhạt
                            </button>
                        </div>
                    </div>
                </div>

                {/* Footer buttons */}
                <div style={{
                    padding: '14px 20px',
                    borderTop: '1px solid #e2e8f0',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '10px',
                    background: '#ffffff',
                }}>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isUploading}
                        style={{
                            padding: '8px 16px',
                            borderRadius: '8px',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            color: '#475569',
                            cursor: 'pointer',
                            fontWeight: 500,
                        }}
                    >
                        Hủy
                    </button>
                    <button
                        type="button"
                        onClick={handleApply}
                        disabled={!imageLoaded || isUploading}
                        style={{
                            padding: '8px 20px',
                            borderRadius: '8px',
                            border: 'none',
                            background: '#4f46e5',
                            color: '#ffffff',
                            cursor: isUploading ? 'not-allowed' : 'pointer',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                        }}
                    >
                        {isUploading ? (
                            <>
                                <span className="spinner" style={{ width: '14px', height: '14px', border: '2px solid #ffffff', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block' }}></span>
                                Đang lưu ảnh...
                            </>
                        ) : (
                            '✅ Áp dụng & Lưu ảnh'
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};
