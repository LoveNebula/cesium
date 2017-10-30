define([
        '../Core/Cartesian2',
        '../Core/Cartesian4',
        '../Core/defined',
        '../Core/destroyObject',
        '../Core/Math',
        '../Core/Matrix4',
        '../Core/Transforms',
        '../Shaders/PostProcessFilters/AdditiveBlend',
        '../Shaders/PostProcessFilters/BrightPass',
        '../Shaders/PostProcessFilters/GaussianBlur1D',
        '../Shaders/PostProcessFilters/PassThrough',
        './PostProcess2',
        './PostProcessSampleMode',
        './SceneFramebuffer'
    ], function(
        Cartesian2,
        Cartesian4,
        defined,
        destroyObject,
        CesiumMath,
        Matrix4,
        Transforms,
        AdditiveBlend,
        BrightPass,
        GaussianBlur1D,
        PassThrough,
        PostProcess,
        PostProcessSampleMode,
        SceneFramebuffer) {
    'use strict';

    function SunPostProcess() {
        this._sceneFramebuffer = new SceneFramebuffer();

        var scale = 0.25;
        var processes = new Array(6);

        processes[0] = new PostProcess({
            fragmentShader : PassThrough,
            textureScale : scale,
            forcePowerOfTwo : true,
            samplingMode : PostProcessSampleMode.LINEAR
        });

        var brightPass = processes[1] = new PostProcess({
            fragmentShader : BrightPass,
            uniformValues : {
                u_avgLuminance : 0.5, // A guess at the average luminance across the entire scene
                u_threshold : 0.25,
                u_offset : 0.1
            },
            textureScale : scale,
            forcePowerOfTwo : true
        });

        var that = this;
        this._delta = 1.0;
        this._sigma = 2.0;
        this._blurStep = new Cartesian2();

        processes[2] = new PostProcess({
            fragmentShader : GaussianBlur1D,
            uniformValues : {
                u_step : function() {
                    that._blurStep.x = that._blurStep.y = 1.0 / brightPass.outputTexture.width;
                    return that._blurStep;
                },
                u_delta : function() {
                    return that._delta;
                },
                u_sigma : function() {
                    return that._sigma;
                },
                u_direction : 0.0
            },
            textureScale : scale,
            forcePowerOfTwo : true
        });

        processes[3] = new PostProcess({
            fragmentShader : GaussianBlur1D,
            uniformValues : {
                u_step : function() {
                    that._blurStep.x = that._blurStep.y = 1.0 / brightPass.outputTexture.width;
                    return that._blurStep;
                },
                u_delta : function() {
                    return that._delta;
                },
                u_sigma : function() {
                    return that._sigma;
                },
                u_direction : 1.0
            },
            textureScale : scale,
            forcePowerOfTwo : true
        });

        processes[4] = new PostProcess({
            fragmentShader : PassThrough,
            samplingMode : PostProcessSampleMode.LINEAR
        });

        this._uCenter = new Cartesian2();
        this._uRadius = undefined;

        processes[5] = new PostProcess({
            fragmentShader : AdditiveBlend,
            uniformValues : {
                u_center : function() {
                    return that._uCenter;
                },
                u_radius : function() {
                    return that._uRadius;
                },
                colorTexture2 : function() {
                    return that._sceneFramebuffer.getFramebuffer().getColorTexture(0);
                }
            }
        });

        this._processes = processes;
    }

    var sunPositionECScratch = new Cartesian4();
    var sunPositionWCScratch = new Cartesian2();
    var sizeScratch = new Cartesian2();
    var postProcessMatrix4Scratch= new Matrix4();

    function updateSunPosition(postProcess, context, viewport) {
        var us = context.uniformState;
        var sunPosition = us.sunPositionWC;
        var viewMatrix = us.view;
        var viewProjectionMatrix = us.viewProjection;
        var projectionMatrix = us.projection;

        // create up sampled render state
        var viewportTransformation = Matrix4.computeViewportTransformation(viewport, 0.0, 1.0, postProcessMatrix4Scratch);
        var sunPositionEC = Matrix4.multiplyByPoint(viewMatrix, sunPosition, sunPositionECScratch);
        var sunPositionWC = Transforms.pointToGLWindowCoordinates(viewProjectionMatrix, viewportTransformation, sunPosition, sunPositionWCScratch);

        sunPositionEC.x += CesiumMath.SOLAR_RADIUS;
        var limbWC = Transforms.pointToGLWindowCoordinates(projectionMatrix, viewportTransformation, sunPositionEC, sunPositionEC);
        var sunSize = Cartesian2.magnitude(Cartesian2.subtract(limbWC, sunPositionWC, limbWC)) * 30.0 * 2.0;

        var size = sizeScratch;
        size.x = sunSize;
        size.y = sunSize;

        //var scissorRectangle = this._upSamplePassState.scissorTest.rectangle;
        //scissorRectangle.x = Math.max(sunPositionWC.x - size.x * 0.5, 0.0);
        //scissorRectangle.y = Math.max(sunPositionWC.y - size.y * 0.5, 0.0);
        //scissorRectangle.width = Math.min(size.x, width);
        //scissorRectangle.height = Math.min(size.y, height);

        postProcess._uCenter = Cartesian2.clone(sunPositionWC, postProcess._uCenter);
        postProcess._uRadius = Math.max(size.x, size.y) * 0.15;

        // create down sampled render state
        //viewportTransformation = Matrix4.computeViewportTransformation(downSampleViewport, 0.0, 1.0, postProcessMatrix4Scratch);
        //sunPositionWC = Transforms.pointToGLWindowCoordinates(viewProjectionMatrix, viewportTransformation, sunPosition, sunPositionWCScratch);

        //size.x *= downSampleWidth / width;
        //size.y *= downSampleHeight / height;

        //scissorRectangle = this._downSamplePassState.scissorTest.rectangle;
        //scissorRectangle.x = Math.max(sunPositionWC.x - size.x * 0.5, 0.0);
        //scissorRectangle.y = Math.max(sunPositionWC.y - size.y * 0.5, 0.0);
        //scissorRectangle.width = Math.min(size.x, width);
        //scissorRectangle.height = Math.min(size.y, height);

        //this._downSamplePassState.context = context;
        //this._upSamplePassState.context = context;
    }

    SunPostProcess.prototype.clear = function(context, passState, clearColor) {
        this._sceneFramebuffer.clear(context, passState, clearColor);

        var processes = this._processes;
        var length = processes.length;
        for (var i = 0; i < length; ++i) {
            processes[i].clear(context);
        }
    };

    SunPostProcess.prototype.update = function(passState) {
        var context = passState.context;
        var viewport = passState.viewport;
        updateSunPosition(this, context, viewport);

        var processes = this._processes;
        var length = processes.length;

        this._sceneFramebuffer.update(context);
        var framebuffer = this._sceneFramebuffer.getFramebuffer();
        processes[0]._setColorTexture(framebuffer.getColorTexture(0));
        processes[0].update(context);

        for (var i = 1; i < length; ++i) {
            var process = processes[i];
            process._setColorTexture(processes[i - 1].outputTexture);
            process.update(context);
        }

        return framebuffer;
    };

    SunPostProcess.prototype.execute = function(context) {
        var processes = this._processes;
        var length = processes.length;
        for (var i = 0; i < length; ++i) {
            processes[i].execute(context);
        }
    };

    SunPostProcess.prototype.copy = function(context, framebuffer) {
        if (!defined(this._copyColorCommand)) {
            var that = this;
            this._copyColorCommand = context.createViewportQuadCommand(PassThrough, {
                uniformMap : {
                    u_colorTexture : function() {
                        return that._processes[that._processes.length - 1].outputTexture;
                    }
                },
                owner : this
            });
        }

        this._copyColorCommand.framebuffer = framebuffer;
        this._copyColorCommand.execute(context);
    };

    SunPostProcess.prototype.isDestroyed = function() {
        return false;
    };

    SunPostProcess.prototype.destroy = function() {
        return destroyObject(this);
    };

    return SunPostProcess;
});
