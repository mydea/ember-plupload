/* globals plupload */
import Ember from "ember";
import File from "./file";
import trim from "./trim";

var get = Ember.get;
var set = Ember.set;
var bool = Ember.computed.bool;
var bind = Ember.run.bind;

var summation = function (target, key) {
  return target.reduce(function (E, obj) {
    return E + get(obj, key);
  }, 0);
};

/**

  @namespace ember-plupload
  @class FileBucket
  @extend Ember.ArrayProxy
  @extend Ember.TargetActionSupport
 */
var FileBucket = Ember.ArrayProxy.extend(Ember.TargetActionSupport, /** @scope FileBucket.prototype */{

  name: null,

  uploading: bool('length'),

  queues: null,

  init: function () {
    set(this, 'queues', []);
    set(this, 'orphanedQueues', []);

    set(this, 'content', []);
    this._super();
  },

  makeQueue: function (component, config) {
    var uploader = new plupload.Uploader(config);

    uploader.bind('FilesAdded',     bind(this, 'filesAdded'));
    uploader.bind('FilesRemoved',   bind(this, 'filesRemoved'));
    uploader.bind('BeforeUpload',   bind(this, 'progressDidChange'));
    uploader.bind('UploadProgress', bind(this, 'progressDidChange'));
    uploader.bind('FileUploaded',   bind(this, 'fileUploaded'));
    uploader.bind('UploadComplete', bind(this, 'uploadComplete'));
    uploader.bind('Error',          bind(this, 'onError'));

    get(this, 'queues').pushObject(uploader);

    uploader.init();
  },

  /**
    Orphan the active plupload object so
    we garbage collect the queues.
   */
  orphan: function () {
    var orphans = get(this, 'orphanedQueues');
    var activeQueues = get(this, 'queues').filter(function (queue) {
      return orphans.indexOf(queue) === -1;
    });
    var queue = get(activeQueues, 'lastObject');
    if (get(queue, 'total.queued') > 0) {
      orphans.pushObject(queue);
    } else {
      this.garbageCollectUploader(queue);
    }
  },

  destroy: function () {
    this._super();
    get(this, 'queues').invoke('unbindAll');
    set(this, 'content', []);
    set(this, 'queues', null);
  },

  progress: function () {
    var queues        = get(this, 'queues'),
        totalSize     = summation(queues, 'total.size'),
        totalUploaded = summation(queues, 'total.loaded'),
        percent       = totalUploaded / totalSize || 0;

    return Math.floor(percent * 100);
  }.property(),

  filesAdded: function (uploader, files) {
    for (var i = 0, len = files.length; i < len; i++) {
      var file = File.create({
        uploader: uploader,
        file: files[i]
      });

      this.pushObject(file);
      this.triggerAction({
        target: get(this, 'target'),
        action: get(this, 'onQueued'),
        actionContext: [
          file,
          {
            name: get(this, 'name'),
            uploader: uploader
          }
        ]
      });
    }
  },

  filesRemoved: function (uploader, files) {
    for (var i = 0, len = files.length; i < len; i++) {
      var file = this.findProperty('id', files[i].id);
      if (file) {
        this.removeObject(file);
      }
    }
  },

  progressDidChange: function (uploader, file) {
    file = this.findProperty('id', file.id);
    if (file) {
      file.notifyPropertyChange('progress');
    }

    this.notifyPropertyChange('progress');
  },

  fileUploaded: function (uploader, file, response) {
    var body = trim(response.response);
    var headers = response.responseHeaders.split('\n').without('').reduce(function (headers, header) {
      var parts = header.split(/^([A-Za-z_-]*:)/);
      headers[parts[1].slice(0, -1)] = trim(parts[2]);
      return headers;
    }, {});

    // Parse body according to the Content-Type received by the server
    switch (headers['Content-Type']) {
    case 'text/html':
      body = Ember.$.parseHTML(body);
      break;
    case 'text/xml':
      body = Ember.$.parseXML(body);
      break;
    case 'application/json':
    case 'application/javascript':
      body = Ember.$.parseJSON(body);
      break;
    }

    var results = {
      status: response.status,
      body: body,
      headers: headers
    };

    file = this.findProperty('id', file.id);
    if (file) {
      this.removeObject(file);
    }

    // NOTE: Plupload calls UploadProgress upon triggering FileUploaded,
    //       so we don't need to trigger a progress event
    if (response.status === 204 ||
        response.status === 200) {
      file._deferred.resolve(results);
    } else {
      file._deferred.reject(results);
    }
  },

  garbageCollectUploader: function (uploader) {
    get(this, 'queues').removeObject(uploader);
    get(this, 'orphanedQueues').removeObject(uploader);
    this.filterProperty('uploader', uploader).invoke('destroy');
    uploader.unbindAll();
  },

  uploadComplete: function (uploader) {
    // Clean up the orphaned uploader and it's files
    if (get(this, 'orphanedQueues').indexOf(uploader) !== -1) {
      this.garbageCollectUploader(uploader);
    }
  },

  onError: function (uploader, error) {
    if (error.file) {
      var file = this.findProperty('id', error.file.id);
      set(file, 'error', error.file);
    } else {
      set(this, 'error', error);
    }
  }
});

export default FileBucket;
