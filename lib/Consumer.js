var net = require('net');
var _ = require('underscore');
var Message = require('./Message');
var BufferMaker = require('buffermaker');
var bignum = require('bignum');
var OffsetsResponse = require('./OffsetsResponse');
var Protocol = require('./Protocol');
var FetchResponse = require('./FetchResponse');

var Consumer = function(options){
  this.MAX_MESSAGE_SIZE = 1024 * 1024; // 1 megabyte
  this.DEFAULT_POLLING_INTERVAL = 2; // 2 seconds
  this.MAX_OFFSETS = 1;
  this.LATEST_OFFSET = -1;
  this.EARLIEST_OFFSET = -2;
  this.RequestType = {
    PRODUCE      : 0,
    FETCH        : 1,
    MULTIFETCH   : 2,
    MULTIPRODUCE : 3,
    OFFSETS      : 4
  };

  options = options || {};
  this.topic = options.topic || 'test';
  this.partition = options.partition || 0;
  this.host = options.host || 'localhost';
  this.port = options.port || 9092;
  this.offset = options.offset;
  this.maxMessageSize = options.maxMessageSize || this.MAX_MESSAGE_SIZE;
  this.polling = options.polling  || this.DEFAULT_POLLING_INTERVAL;
  this.unprocessedData = new Buffer([]);

  this.requestMode = null;
  this.responseBuffer = new Buffer([]);
  this.protocol = new Protocol(this.topic, this.partition, this.MAX_MESSAGE_SIZE);
  this.offsetsResponder = function(){};
  this.fetchResponder = function(){};

};


Consumer.prototype.onOffsets = function(handler){  this.offsetsResponder = handler; };
Consumer.prototype.onFetch = function(handler){  this.fetchResponder = handler; };

Consumer.prototype._setRequestMode = function(mode){
  this.requestMode = mode;
  console.log("REQUEST MODE: ", mode);
};

Consumer.prototype._unsetRequestMode = function(){
  this.requestMode = null;
  console.log("REQUEST MODE: [NONE]");
};

Consumer.prototype.connect = function(cb){
  console.log("in connect!");
  var that = this;
  this.socket = net.createConnection({port : this.port, host : this.host}, function(){
    console.log("connected");
    cb();
  });

  this.socket.on('end', function(){
    console.log("end");
  });
  this.socket.on('timeout', function(){
    console.log("timeout");
  });
  this.socket.on('drain', function(){
    console.log("drain");
  });
  this.socket.on('error', function(err){
    console.log("error: ", err);
  });
  this.socket.on('close', function(){
    console.log("close");
  });
  this.socket.on('data', function(data){
    that.responseBuffer = Buffer.concat([that.responseBuffer, data]); 
    switch(that.requestMode){
      case "fetch":
        console.log("FETCH MODE");
        console.log("consumer got data: ", data);
        // message fetch
        var err = null;
        var response = null;
        try {
          console.log("REALLY WANT TO GET TO FETCH RESPONSE...");
          response = FetchResponse.fromBytes(that.responseBuffer);
          console.log("FETCH RESPONSE: ", response);
        } catch(ex){
          console.log("WTH! got in an error scenario here!");
          console.log("ex: ", ex);
          console.log("data: ", data);
          err = ex;
        }
        that.fetchResponder(err, response);
        that._unsetRequestMode();
      break;



      case "offsets":
        console.log("got data in offsets mode");
        console.log("responseBuffer: ", that.responseBuffer);
        console.log("data: ", data);
        console.log("concatted responseBuffer: ", that.responseBuffer);
        OffsetsResponse.fromBytes(that.responseBuffer, function(err, res){
          if (!!err) {
            if (err === "incomplete response"){
              // do nothing.  we'll wait for more data.
              console.log("incomplete. do nothing.");
              return;
            } else {
              return that.offsetsResponder(err);
            }
          }
          that._unsetRequestMode();
          that.responseBuffer = that.responseBuffer.slice(res.size);
          var offsets = res.offsets;
          console.log("REzzzzzzzzzz", res);
          console.log("============================== OFFSETS!!! ", offsets);
          return that.offsetsResponder(null, offsets);
        });
      break;


      default:
        console.log("wth: ", data);
        throw "Got a response when no response was expected!";

    }
  });
};


Consumer.prototype.sendConsumeRequest = function(offset, cb){
  this._setRequestMode("fetch");
  this.onFetch(cb);
  var that = this;
  var request = this.protocol.encodeFetchRequest( offset );
  this.socket.write( request );
  console.log("wrote a fetch request to the socket", request);
};

Consumer.prototype.consume = function(cb){
  console.log("in consume");
  var consumer = this;
  var offset;
  if (this.offset === undefined){
      this.getOffsets(function(err, offsets){
        console.log("got offsets: ", offsets);
        offset = offsets[0];
        console.log("setting consumer offset to ", offset);
        consumer.offset = offset;
        consumer.sendConsumeRequest(offset, function(err, fetchResponse){
          console.log("---> back with the response to consume-request (undefined)");
          if (!!err){
            console.log("err from sendConsumerRequest: ", err);
          }
          console.log("---> sendConsumeRequest CB input", err, fetchResponse);
          if (err){
            return cb(err);
          }
          console.log("BYTELENGTH: ", fetchResponse.byteLength());
          consumer.offset = bignum(fetchResponse.byteLength()).add(consumer.offset);
          cb(err, fetchResponse.messages);
        });
      });
  } else {
    offset = this.offset;
    console.log("offset: ", offset);
    consumer.sendConsumeRequest(offset, function(err, fetchResponse){
      console.log("---> back with the response to consume-request");
      if (err){
        return cb(err);
      }
      console.log("defined offset | sending consume request ", err, fetchResponse);
      var newOffset = bignum(fetchResponse.byteLength()).add(consumer.offset);
      console.log("setting consumer offset to ", newOffset);
      consumer.offset = newOffset;
      cb(err, fetchResponse.messages);
    });
  }

};

Consumer.prototype.getOffsets = function(cb){
  this.onOffsets(cb);
  this._setRequestMode("offsets");
  var that = this;
  var request = this.protocol.encodeOffsetsRequest(-1, this.MAX_OFFSETS);
  console.log("writing offsets request: ", request);
  this.socket.write(request);
  console.log("request written");
 
};


module.exports = Consumer;
